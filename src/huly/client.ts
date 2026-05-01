/**
 * huly/client.ts
 *
 * Thin wrapper around @hcengineering/api-client.
 * Handles connection lifecycle and provides typed helpers for the
 * document operations pod-onedev needs.
 *
 * The transactor connection is a persistent WebSocket — this wrapper
 * manages reconnection and exposes the operations the rest of the
 * service needs without leaking api-client internals everywhere.
 */

// TODO: Replace with real imports once @hcengineering/api-client
// and @hcengineering/tracker are installed.
// import { connect, type Client } from '@hcengineering/api-client'
// import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'

export interface HulyIssueCreate {
  workspaceId: string
  projectId: string   // Ref<Project>
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
  issueId: string   // Ref<Issue>
  text: string
}

/**
 * HulyClient wraps @hcengineering/api-client for pod-onedev's needs.
 *
 * TODO: Implement once packages are installed. The structure here
 * documents the intended interface so the rest of the service can
 * be written against it independently.
 */
export class HulyClient {
  private connected = false

  async connect(accountsUrl: string, serverSecret: string): Promise<void> {
    // TODO: implement
    // const client = await connect(accountsUrl, { token: serverSecret, workspace: ... })
    console.log(`[huly] connecting to ${accountsUrl}`)
    this.connected = true
  }

  async createIssue(data: HulyIssueCreate): Promise<string> {
    // TODO: implement
    // return client.createDoc(tracker.class.Issue, data.projectId, { ... })
    throw new Error('HulyClient.createIssue not yet implemented')
  }

  async updateIssue(issueId: string, data: HulyIssueUpdate): Promise<void> {
    // TODO: implement
    // return client.updateDoc(tracker.class.Issue, issueId, data)
    throw new Error('HulyClient.updateIssue not yet implemented')
  }

  async transitionIssue(issueId: string, statusName: string): Promise<void> {
    // TODO: implement
    throw new Error('HulyClient.transitionIssue not yet implemented')
  }

  async createComment(data: HulyCommentCreate): Promise<string> {
    // TODO: implement
    throw new Error('HulyClient.createComment not yet implemented')
  }

  async updateComment(commentId: string, text: string): Promise<void> {
    // TODO: implement
    throw new Error('HulyClient.updateComment not yet implemented')
  }

  async deleteComment(commentId: string): Promise<void> {
    // TODO: implement
    throw new Error('HulyClient.deleteComment not yet implemented')
  }

  /**
   * Subscribe to Huly issue changes so we can push them back to OneDev.
   * Called by worker.ts.
   */
  async watchIssues(projectId: string, callback: (change: HulyIssueChange) => Promise<void>): Promise<void> {
    // TODO: implement live query subscription via api-client
    throw new Error('HulyClient.watchIssues not yet implemented')
  }

  isConnected(): boolean {
    return this.connected
  }

  async close(): Promise<void> {
    this.connected = false
  }
}

export interface HulyIssueChange {
  type: 'create' | 'update' | 'delete'
  issueId: string
  title?: string
  description?: string
  status?: string
}
