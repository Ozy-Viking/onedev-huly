/**
 * worker.ts
 *
 * Outbound sync: Huly → OneDev.
 *
 * Watches the Huly transactor change feed for issues in mapped projects
 * and reflects changes back to OneDev via REST API.
 *
 * This is the counterpart to main.ts (inbound webhooks).
 * Mirrors the worker.ts pattern used in pod-github.
 */

import type { Config } from './config.js'
import type { HulyClient, HulyIssueChange } from './huly/client.js'
import type { OneDevClient } from './onedev/client.js'
import type { MappingStore } from './huly/mapping.js'

const BOT_COMMENT_MARKER = '<!-- pod-onedev -->'

export class Worker {
  private running = false

  constructor(
    private readonly config: Config,
    private readonly huly: HulyClient,
    private readonly onedev: OneDevClient,
    private readonly mappings: MappingStore,
  ) {}

  async start(): Promise<void> {
    this.running = true
    console.log('[worker] started, watching Huly change feed')

    // TODO: Replace with real project IDs from configuration/mapping store
    const watchedProjects: string[] = []

    for (const projectId of watchedProjects) {
      await this.huly.watchIssues(projectId, (change) => this.handleHulyChange(change))
    }
  }

  async stop(): Promise<void> {
    this.running = false
    console.log('[worker] stopped')
  }

  private async handleHulyChange(change: HulyIssueChange): Promise<void> {
    const mapping = this.mappings.getIssueByHuly(change.issueId)

    if (mapping === undefined) {
      // Issue not mapped to OneDev — could be a Huly-only issue, ignore
      return
    }

    try {
      switch (change.type) {
        case 'update':
          await this.syncIssueUpdateToOneDev(mapping.onedevIssueId, change)
          break
        case 'delete':
          // We don't delete OneDev issues when Huly issues are deleted (per FR-4.4)
          this.mappings.deleteIssue(mapping.onedevProjectPath, mapping.onedevIssueNumber)
          break
        default:
          break
      }
    } catch (err) {
      // Per NFR-2.3: a failed sync must not block others
      console.error(`[worker] failed to sync issue ${change.issueId} to OneDev:`, err)
    }
  }

  private async syncIssueUpdateToOneDev(onedevIssueId: number, change: HulyIssueChange): Promise<void> {
    if (change.title !== undefined || change.description !== undefined) {
      await this.onedev.updateIssue(
        onedevIssueId,
        change.title ?? '',
        change.description,
      )
    }

    if (change.status !== undefined) {
      await this.onedev.transitionIssue(onedevIssueId, change.status)
    }
  }

  /**
   * Checks whether a comment was originally posted by this service,
   * preventing sync loops.
   */
  isOwnComment(content: string): boolean {
    return content.includes(BOT_COMMENT_MARKER)
  }

  /**
   * Wraps comment content with the bot marker so we can detect it later.
   */
  markComment(content: string): string {
    return `${content}\n\n${BOT_COMMENT_MARKER}`
  }
}
