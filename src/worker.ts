/**
 * worker.ts
 *
 * Outbound sync: Huly → OneDev.
 *
 * Watches the Huly change feed for issues in mapped projects and
 * reflects changes back to OneDev via REST API.
 */

import type { Config } from './config.js'
import type { HulyClient, HulyIssueChange } from './huly/client.js'
import type { OneDevClient } from './onedev/client.js'
import type { MappingStore, ProjectConfig } from './huly/mapping.js'

const BOT_COMMENT_MARKER = '<!-- pod-onedev -->'

export class Worker {
  private running = false

  constructor (
    private readonly config: Config,
    private readonly huly: HulyClient,
    private readonly onedev: OneDevClient,
    private readonly mappings: MappingStore,
  ) {}

  async start (): Promise<void> {
    this.running = true
    console.log('[worker] started, watching Huly change feed')

    for (const projectConfig of this.mappings.listProjectConfigs()) {
      await this.watchProject(projectConfig)
    }
  }

  async stop (): Promise<void> {
    this.running = false

    for (const projectConfig of this.mappings.listProjectConfigs()) {
      await this.unwatchProject(projectConfig)
    }

    console.log('[worker] stopped')
  }

  /** Add a new project mapping at runtime (called when /projects POST fires). */
  async addProject (projectConfig: ProjectConfig): Promise<void> {
    await this.watchProject(projectConfig)
  }

  /** Remove a project mapping at runtime (called when /projects DELETE fires). */
  async removeProject (projectConfig: ProjectConfig): Promise<void> {
    await this.unwatchProject(projectConfig)
  }

  /** Public entry for external callers (e.g. tests). */
  async handleChange (change: HulyIssueChange): Promise<void> {
    return this.handleHulyChange(change)
  }

  private async watchProject (projectConfig: ProjectConfig): Promise<void> {
    // Resolve the human-readable identifier to a Huly Ref before polling
    const projectId = await this.huly.resolveProjectId(
      projectConfig.hulyWorkspace,
      projectConfig.hulyProjectIdentifier,
    )
    await this.huly.watchIssues(
      projectConfig.hulyWorkspace,
      projectId,
      (change) => this.handleHulyChange(change),
    )
  }

  private async unwatchProject (projectConfig: ProjectConfig): Promise<void> {
    try {
      const projectId = await this.huly.resolveProjectId(
        projectConfig.hulyWorkspace,
        projectConfig.hulyProjectIdentifier,
      )
      this.huly.stopWatching(projectConfig.hulyWorkspace, projectId)
    } catch {
      // Already gone or never resolved — nothing to stop
    }
  }

  private async handleHulyChange (change: HulyIssueChange): Promise<void> {
    const mapping = this.mappings.getIssueByHuly(change.issueId)

    if (mapping === undefined) {
      // Issue not mapped to OneDev — could be Huly-only, ignore
      return
    }

    try {
      switch (change.type) {
        case 'update':
          await this.syncIssueUpdateToOneDev(mapping.onedevIssueId, change)
          break
        case 'delete':
          // Per FR-4.4: don't delete OneDev issues when Huly issues are deleted
          this.mappings.deleteIssue(mapping.onedevProjectPath, mapping.onedevIssueNumber)
          this.huly.removePersistentIssueMapping(
            mapping.hulyWorkspace,
            mapping.onedevProjectPath,
            mapping.onedevIssueNumber,
          ).catch((err) => console.error('[worker] failed to remove persistent issue mapping:', err))
          break
        default:
          break
      }
    } catch (err) {
      // Per NFR-2.3: a failed sync must not block others
      console.error(`[worker] failed to sync issue ${change.issueId} to OneDev:`, err)
    }
  }

  private async syncIssueUpdateToOneDev (onedevIssueId: number, change: HulyIssueChange): Promise<void> {
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

  isOwnComment (content: string): boolean {
    return content.includes(BOT_COMMENT_MARKER)
  }

  markComment (content: string): string {
    return `${content}\n\n${BOT_COMMENT_MARKER}`
  }
}
