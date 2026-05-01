/**
 * onedev/client.ts
 *
 * Thin wrapper around OneDev's REST API.
 * Auth is a plain bearer token — no JWT signing, no token refresh.
 *
 * API docs available at: https://<your-onedev>/~help/api
 */

import fetch from 'node-fetch'
import type { OneDevIssue, OneDevIssueComment, OneDevPullRequest } from './types.js'

export interface OneDevClientConfig {
  baseUrl: string       // e.g. https://onedev.example.com
  accessToken: string   // personal access token
}

export class OneDevClient {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>

  constructor(config: OneDevClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.headers = {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  async getIssue(projectPath: string, issueNumber: number): Promise<OneDevIssue> {
    return this.get(`/~api/issues?query="Project"+is+"${projectPath}"+and+"Number"+is+"${issueNumber}"`)
      .then((list: OneDevIssue[]) => {
        if (list.length === 0) throw new Error(`Issue #${issueNumber} not found in ${projectPath}`)
        return list[0]
      })
  }

  async createIssue(projectId: number, title: string, description?: string): Promise<number> {
    const body = { projectId, title, description: description ?? '' }
    return this.post('/~api/issues', body) as Promise<number>
  }

  async updateIssue(issueId: number, title: string, description?: string): Promise<void> {
    await this.post(`/~api/issues/${issueId}`, { title, description: description ?? '' })
  }

  async transitionIssue(issueId: number, state: string): Promise<void> {
    await this.post(`/~api/issues/${issueId}/transitions`, { state })
  }

  // ---------------------------------------------------------------------------
  // Issue comments
  // ---------------------------------------------------------------------------

  async getIssueComments(issueId: number): Promise<OneDevIssueComment[]> {
    return this.get(`/~api/issue-comments?query="Issue"+is+"${issueId}"`)
  }

  async createIssueComment(issueId: number, content: string): Promise<number> {
    return this.post('/~api/issue-comments', { issueId, content }) as Promise<number>
  }

  async updateIssueComment(commentId: number, content: string): Promise<void> {
    await this.post(`/~api/issue-comments/${commentId}`, { content })
  }

  async deleteIssueComment(commentId: number): Promise<void> {
    await this.delete(`/~api/issue-comments/${commentId}`)
  }

  // ---------------------------------------------------------------------------
  // Pull requests
  // ---------------------------------------------------------------------------

  async getPullRequest(projectPath: string, prNumber: number): Promise<OneDevPullRequest> {
    return this.get(`/~api/pull-requests?query="Project"+is+"${projectPath}"+and+"Number"+is+"${prNumber}"`)
      .then((list: OneDevPullRequest[]) => {
        if (list.length === 0) throw new Error(`PR #${prNumber} not found in ${projectPath}`)
        return list[0]
      })
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`OneDev GET ${path} failed: ${res.status} ${res.statusText}`)
    return res.json()
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`OneDev POST ${path} failed: ${res.status} ${res.statusText}`)
    const text = await res.text()
    return text === '' ? undefined : JSON.parse(text)
  }

  private async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers,
    })
    if (!res.ok) throw new Error(`OneDev DELETE ${path} failed: ${res.status} ${res.statusText}`)
  }
}
