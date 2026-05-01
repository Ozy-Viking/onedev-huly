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
import { OneDevClient } from './onedev/client.js'
import type { MappingStore, ProjectConfig } from './huly/mapping.js'

const BOT_COMMENT_MARKER = '<!-- pod-onedev -->'

interface ProjectEntry {
  config: ProjectConfig
  /** OneDev numeric project ID (resolved once at watch-start). */
  onedevProjectNumericId: number
  client: OneDevClient
}

export class Worker {
  private running = false

  /**
   * Per-project context keyed by the resolved Huly project Ref.
   * Populated in watchProject; used in handleHulyChange to know which
   * OneDev project and client to use for a given Huly project.
   */
  private readonly projectEntries = new Map<string, ProjectEntry>()

  constructor (
    private readonly config: Config,
    private readonly huly: HulyClient,
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

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async watchProject (projectConfig: ProjectConfig): Promise<void> {
    const hulyProjectId = await this.huly.resolveProjectId(
      projectConfig.hulyWorkspace,
      projectConfig.hulyProjectIdentifier,
    )

    const client = new OneDevClient({
      baseUrl: projectConfig.onedevBaseUrl,
      accessToken: projectConfig.onedevAccessToken,
    })

    // Resolve the OneDev numeric project ID once up front so we don't have
    // to look it up on every issue creation.
    const onedevProject = await client.getProjectByPath(projectConfig.onedevProjectPath)

    this.projectEntries.set(hulyProjectId, {
      config: projectConfig,
      onedevProjectNumericId: onedevProject.id,
      client,
    })

    await this.huly.watchIssues(
      projectConfig.hulyWorkspace,
      hulyProjectId,
      (change) => this.handleHulyChange(change),
      this.config.hulyPollIntervalMs,
    )
  }

  private async unwatchProject (projectConfig: ProjectConfig): Promise<void> {
    try {
      const hulyProjectId = await this.huly.resolveProjectId(
        projectConfig.hulyWorkspace,
        projectConfig.hulyProjectIdentifier,
      )
      this.huly.stopWatching(projectConfig.hulyWorkspace, hulyProjectId)
      this.projectEntries.delete(hulyProjectId)
    } catch {
      // Already gone or never resolved — nothing to stop
    }
  }

  private async handleHulyChange (change: HulyIssueChange): Promise<void> {
    const mapping = this.mappings.getIssueByHuly(change.issueId)

    if (mapping === undefined) {
      // No OneDev mapping yet.
      if (change.type === 'create') {
        // FR-2.1: new Huly-native issue — create it in OneDev.
        await this.createOneDevIssueFromHuly(change)
      }
      return
    }

    try {
      switch (change.type) {
        case 'create':
        case 'update':
          await this.syncIssueUpdateToOneDev(mapping, change)
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

  private async createOneDevIssueFromHuly (change: HulyIssueChange): Promise<void> {
    const entry = this.projectEntries.get(change.projectId)
    if (entry === undefined) {
      // Project not in our watch map — shouldn't happen, but guard anyway
      console.warn(`[worker] no project entry for Huly project ${change.projectId}`)
      return
    }

    const { config, client, onedevProjectNumericId } = entry

    const created = await client.createIssue(
      onedevProjectNumericId,
      change.title ?? '(Untitled)',
      change.description,
    )

    const newMapping = {
      onedevProjectPath: config.onedevProjectPath,
      onedevIssueNumber: created.number,
      onedevIssueId: created.id,
      hulyWorkspace: change.workspaceId,
      hulyProjectIdentifier: config.hulyProjectIdentifier,
      hulyIssueId: change.issueId,
    }

    this.mappings.setIssue(newMapping)
    this.huly.persistIssueMapping(change.workspaceId, newMapping)
      .catch((err) => console.error('[worker] failed to persist issue mapping:', err))

    console.log(
      `[worker] created OneDev issue #${created.number} from Huly issue ${change.issueId}`,
    )
  }

  private async syncIssueUpdateToOneDev (
    mapping: ReturnType<typeof this.mappings.getIssueByHuly> & object,
    change: HulyIssueChange,
  ): Promise<void> {
    const entry = this.projectEntries.get(change.projectId)
    if (entry === undefined) return

    if (change.title !== undefined || change.description !== undefined) {
      await entry.client.updateIssue(
        mapping.onedevIssueId,
        change.title ?? '',
        change.description,
      )
    }

    if (change.status !== undefined) {
      await entry.client.transitionIssue(mapping.onedevIssueId, change.status)
    }
  }

  isOwnComment (content: string): boolean {
    return content.includes(BOT_COMMENT_MARKER)
  }

  markComment (content: string): string {
    return `${content}\n\n${BOT_COMMENT_MARKER}`
  }
}
