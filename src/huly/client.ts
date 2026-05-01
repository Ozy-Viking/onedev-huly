/**
 * huly/client.ts
 *
 * Wraps @hcengineering/api-client for pod-onedev's needs.
 *
 * Uses the REST transport (createRestTxOperations) — no persistent WebSocket
 * required for write-path operations. Connections are established lazily per
 * workspace and reused.
 */

import { getWorkspaceToken, createRestTxOperations } from '@hcengineering/api-client'
import type { ServerConfig } from '@hcengineering/api-client'
import { generateId } from '@hcengineering/core'
import type { Ref, Class, Doc, AttachedDoc, Space, TxOperations } from '@hcengineering/core'
import {
  loadIssueMappings,
  loadCommentMappings,
  loadPullRequestMappings,
  saveIssueMapping,
  saveCommentMapping,
  savePullRequestMapping,
  deleteIssueMappingDoc,
  deleteCommentMappingDoc,
} from './persistence.js'
import type { IssueMapping, CommentMapping, PullRequestMapping, MappingStore } from './mapping.js'

// ---------------------------------------------------------------------------
// Tracker class IDs
// These are Huly plugin system identifiers. When @hcengineering/model-onedev
// is created for the upstream contribution, import them from there instead.
// ---------------------------------------------------------------------------

const TRACKER_ISSUE = 'tracker:class:Issue' as unknown as Ref<Class<Doc>>
const TRACKER_PROJECT = 'tracker:class:Project' as unknown as Ref<Class<Doc>>
const CHUNTER_CHAT_MESSAGE = 'chunter:class:ChatMessage' as unknown as Ref<Class<Doc>>

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HulyIssueCreate {
  workspaceId: string
  /** Human-readable project identifier shown in the Huly UI, e.g. "BACK". */
  projectIdentifier: string
  title: string
  description?: string
  externalUrl?: string  // link back to OneDev issue
}

export interface HulyIssueUpdate {
  title?: string
  description?: string
  status?: string
}

export interface HulyCommentCreate {
  workspaceId: string
  issueId: string   // Ref<tracker.class.Issue>
  text: string
}

export interface HulyIssueChange {
  type: 'create' | 'update' | 'delete'
  workspaceId: string
  issueId: string
  title?: string
  description?: string
  status?: string
}

// ---------------------------------------------------------------------------
// HulyClient
// ---------------------------------------------------------------------------

export class HulyClient {
  private accountsUrl = ''
  private serverToken = ''
  private connected = false

  /** Per-workspace TxOperations, keyed by workspace URL slug. */
  private readonly clients = new Map<string, TxOperations>()

  /** Resolved project identifier → Ref cache, keyed by `${workspace}:${identifier}`. */
  private readonly projectIdCache = new Map<string, string>()

  /** Polling timers for watchIssues, keyed by `${workspace}:${projectId}`. */
  private readonly pollers = new Map<string, ReturnType<typeof setInterval>>()

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async connect (accountsUrl: string, serverSecret: string): Promise<void> {
    this.accountsUrl = accountsUrl
    this.serverToken = serverSecret
    this.connected = true
    console.log(`[huly] ready (accounts: ${accountsUrl})`)
  }

  isConnected (): boolean {
    return this.connected
  }

  async close (): Promise<void> {
    for (const timer of this.pollers.values()) {
      clearInterval(timer)
    }
    this.pollers.clear()
    this.clients.clear()
    this.connected = false
  }

  // --------------------------------------------------------------------------
  // Internal: per-workspace connection
  // --------------------------------------------------------------------------

  private async getOps (workspace: string): Promise<TxOperations> {
    const existing = this.clients.get(workspace)
    if (existing !== undefined) return existing

    // Pass the ServerConfig directly to avoid fetching /config.json from
    // the frontend URL (which may not be reachable within the Docker network).
    const config: ServerConfig = {
      ACCOUNTS_URL: this.accountsUrl,
      COLLABORATOR_URL: '',
      FILES_URL: '',
      UPLOAD_URL: '',
    }

    const { endpoint, token, workspaceId } = await getWorkspaceToken(
      this.accountsUrl,
      { token: this.serverToken, workspace },
      config,
    )

    const ops = await createRestTxOperations(endpoint, String(workspaceId), token)
    this.clients.set(workspace, ops)
    return ops
  }

  // --------------------------------------------------------------------------
  // Issues
  // --------------------------------------------------------------------------

  async createIssue (data: HulyIssueCreate): Promise<string> {
    const ops = await this.getOps(data.workspaceId)
    const projectId = await this.resolveProjectId(data.workspaceId, data.projectIdentifier)
    const id = generateId()

    await ops.createDoc(
      TRACKER_ISSUE,
      projectId as unknown as Ref<Space>,
      {
        title: data.title,
        description: data.description ?? '',
        priority: 0,       // No priority (mapped from OneDev fields later)
        assignee: null,
        component: null,
        milestone: null,
        estimation: 0,
        remainingTime: 0,
        reportedTime: 0,
        childInfo: [],
        relations: [],
        parents: [],
        kind: 'task',
      } as any,
      id as any,
    )

    return id
  }

  async updateIssue (workspaceId: string, issueId: string, data: HulyIssueUpdate): Promise<void> {
    const ops = await this.getOps(workspaceId)
    const update: Record<string, unknown> = {}
    if (data.title !== undefined) update.title = data.title
    if (data.description !== undefined) update.description = data.description
    if (data.status !== undefined) update.status = data.status

    if (Object.keys(update).length === 0) return

    await ops.updateDoc(
      TRACKER_ISSUE,
      '' as unknown as Ref<Space>,  // space not needed for update
      issueId as unknown as Ref<Doc>,
      update as any,
    )
  }

  async transitionIssue (workspaceId: string, issueId: string, statusId: string): Promise<void> {
    await this.updateIssue(workspaceId, issueId, { status: statusId })
  }

  // --------------------------------------------------------------------------
  // Comments
  // --------------------------------------------------------------------------

  async createComment (data: HulyCommentCreate): Promise<string> {
    const ops = await this.getOps(data.workspaceId)
    const id = generateId()

    await ops.addCollection(
      CHUNTER_CHAT_MESSAGE,
      '' as unknown as Ref<Space>,
      data.issueId as unknown as Ref<Doc>,
      TRACKER_ISSUE,
      'comments',
      { message: data.text } as any,
      id as any,
    )

    return id
  }

  async updateComment (workspaceId: string, commentId: string, text: string): Promise<void> {
    const ops = await this.getOps(workspaceId)

    await ops.updateCollection(
      CHUNTER_CHAT_MESSAGE,
      '' as unknown as Ref<Space>,
      commentId as unknown as Ref<AttachedDoc>,
      '' as unknown as Ref<Doc>,
      TRACKER_ISSUE,
      'comments',
      { message: text } as any,
    )
  }

  async deleteComment (workspaceId: string, commentId: string): Promise<void> {
    const ops = await this.getOps(workspaceId)

    await ops.removeCollection(
      CHUNTER_CHAT_MESSAGE,
      '' as unknown as Ref<Space>,
      commentId as unknown as Ref<AttachedDoc>,
      '' as unknown as Ref<Doc>,
      TRACKER_ISSUE,
      'comments',
    )
  }

  // --------------------------------------------------------------------------
  // Change feed (outbound worker)
  // --------------------------------------------------------------------------

  /**
   * Poll Huly for changed issues in a project and invoke the callback.
   * Uses a 30-second polling interval as a pragmatic substitute for
   * live queries (which require a persistent WebSocket via @hcengineering/client).
   */
  async watchIssues (
    workspaceId: string,
    projectId: string,
    callback: (change: HulyIssueChange) => Promise<void>,
  ): Promise<void> {
    const pollKey = `${workspaceId}:${projectId}`
    if (this.pollers.has(pollKey)) return

    let lastCheck = Date.now()

    const poll = async (): Promise<void> => {
      try {
        const ops = await this.getOps(workspaceId)
        const since = lastCheck
        lastCheck = Date.now()

        const issues = await ops.findAll(
          TRACKER_ISSUE,
          { space: projectId as any, modifiedOn: { $gt: since } as any } as any,
        )

        for (const issue of issues) {
          await callback({
            type: 'update',
            workspaceId,
            issueId: issue._id,
            title: (issue as any).title,
            description: (issue as any).description,
            status: (issue as any).status,
          })
        }
      } catch (err) {
        console.error(`[huly] poll error for project ${projectId}:`, err)
      }
    }

    this.pollers.set(pollKey, setInterval(() => { void poll() }, 30_000))
    console.log(`[huly] watching project ${projectId} in workspace ${workspaceId}`)
  }

  stopWatching (workspaceId: string, projectId: string): void {
    const pollKey = `${workspaceId}:${projectId}`
    const timer = this.pollers.get(pollKey)
    if (timer !== undefined) {
      clearInterval(timer)
      this.pollers.delete(pollKey)
    }
  }

  // --------------------------------------------------------------------------
  // Projects
  // --------------------------------------------------------------------------

  /**
   * Resolve a human-readable project identifier (e.g. "BACK") to its internal
   * Huly Ref string. Result is cached for the lifetime of the client.
   */
  async resolveProjectId (workspaceId: string, identifier: string): Promise<string> {
    const cacheKey = `${workspaceId}:${identifier}`
    const cached = this.projectIdCache.get(cacheKey)
    if (cached !== undefined) return cached

    const ops = await this.getOps(workspaceId)
    const project = await ops.findOne(TRACKER_PROJECT, { identifier } as any)
    if (project === undefined) {
      throw new Error(`Huly project "${identifier}" not found in workspace "${workspaceId}"`)
    }

    this.projectIdCache.set(cacheKey, project._id)
    return project._id
  }

  // --------------------------------------------------------------------------
  // Persistence: load all stored mappings for a workspace into the store
  // --------------------------------------------------------------------------

  /**
   * Load persisted OneDev↔Huly mappings from the Huly transactor into the
   * given MappingStore. Call once at startup for each connected workspace.
   */
  async loadMappingsForWorkspace (workspaceId: string, store: MappingStore): Promise<void> {
    const ops = await this.getOps(workspaceId)

    const [issues, comments, prs] = await Promise.all([
      loadIssueMappings(ops),
      loadCommentMappings(ops),
      loadPullRequestMappings(ops),
    ])

    for (const m of issues) store.setIssue(m)
    for (const m of comments) store.setComment(m)
    for (const m of prs) store.setPullRequest(m)

    console.log(`[huly] loaded ${issues.length} issue, ${comments.length} comment, ${prs.length} PR mappings for workspace ${workspaceId}`)
  }

  // --------------------------------------------------------------------------
  // Persistence: per-mutation save/delete (called from webhook handlers)
  // --------------------------------------------------------------------------

  async persistIssueMapping (workspaceId: string, mapping: IssueMapping): Promise<void> {
    const ops = await this.getOps(workspaceId)
    await saveIssueMapping(ops, mapping)
  }

  async persistCommentMapping (workspaceId: string, mapping: CommentMapping): Promise<void> {
    const ops = await this.getOps(workspaceId)
    await saveCommentMapping(ops, mapping)
  }

  async persistPullRequestMapping (workspaceId: string, mapping: PullRequestMapping): Promise<void> {
    const ops = await this.getOps(workspaceId)
    await savePullRequestMapping(ops, mapping)
  }

  async removePersistentIssueMapping (
    workspaceId: string,
    onedevProjectPath: string,
    onedevIssueNumber: number,
  ): Promise<void> {
    const ops = await this.getOps(workspaceId)
    await deleteIssueMappingDoc(ops, onedevProjectPath, onedevIssueNumber)
  }

  async removePersistentCommentMapping (workspaceId: string, onedevCommentId: number): Promise<void> {
    const ops = await this.getOps(workspaceId)
    await deleteCommentMappingDoc(ops, onedevCommentId)
  }
}
