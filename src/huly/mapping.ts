/**
 * huly/mapping.ts
 *
 * Bidirectional ID mapping between OneDev entities and Huly documents.
 *
 * Stores mappings as Huly documents so they survive container restarts.
 * Uses a simple key-value pattern: "onedev:issue:{projectPath}:{issueNumber}"
 * maps to a Huly document Ref<Issue>.
 *
 * NOTE: When upstreaming, this will use @hcengineering/model-onedev typed
 * documents instead of generic key-value storage.
 */

export interface IssueMapping {
  onedevProjectPath: string
  onedevIssueNumber: number
  onedevIssueId: number
  hulyWorkspace: string
  hulyProjectId: string
  hulyIssueId: string   // Ref<Issue>
}

export interface CommentMapping {
  onedevCommentId: number
  hulyCommentId: string  // Ref<Comment>
}

export interface PullRequestMapping {
  onedevProjectPath: string
  onedevPrNumber: number
  onedevPrId: number
  hulyWorkspace: string
  hulyPrId: string  // Ref<PullRequest> — once model-onedev exists
}

/**
 * In-memory mapping store.
 *
 * TODO: Replace with persistent storage via @hcengineering/api-client
 * so mappings survive container restarts. This is the first thing to
 * implement before the service is production-ready.
 */
export class MappingStore {
  private readonly issues = new Map<string, IssueMapping>()
  private readonly issuesByHuly = new Map<string, IssueMapping>()
  private readonly comments = new Map<string, CommentMapping>()
  private readonly pullRequests = new Map<string, PullRequestMapping>()

  // ---- Issue mappings ----

  issueKey(projectPath: string, issueNumber: number): string {
    return `${projectPath}:${issueNumber}`
  }

  setIssue(mapping: IssueMapping): void {
    const key = this.issueKey(mapping.onedevProjectPath, mapping.onedevIssueNumber)
    this.issues.set(key, mapping)
    this.issuesByHuly.set(mapping.hulyIssueId, mapping)
  }

  getIssueByOneDev(projectPath: string, issueNumber: number): IssueMapping | undefined {
    return this.issues.get(this.issueKey(projectPath, issueNumber))
  }

  getIssueByHuly(hulyIssueId: string): IssueMapping | undefined {
    return this.issuesByHuly.get(hulyIssueId)
  }

  deleteIssue(projectPath: string, issueNumber: number): void {
    const key = this.issueKey(projectPath, issueNumber)
    const mapping = this.issues.get(key)
    if (mapping !== undefined) {
      this.issuesByHuly.delete(mapping.hulyIssueId)
      this.issues.delete(key)
    }
  }

  // ---- Comment mappings ----

  setComment(mapping: CommentMapping): void {
    this.comments.set(String(mapping.onedevCommentId), mapping)
  }

  getCommentByOneDev(commentId: number): CommentMapping | undefined {
    return this.comments.get(String(commentId))
  }

  deleteComment(commentId: number): void {
    this.comments.delete(String(commentId))
  }

  // ---- Pull request mappings ----

  prKey(projectPath: string, prNumber: number): string {
    return `pr:${projectPath}:${prNumber}`
  }

  setPullRequest(mapping: PullRequestMapping): void {
    this.pullRequests.set(this.prKey(mapping.onedevProjectPath, mapping.onedevPrNumber), mapping)
  }

  getPullRequestByOneDev(projectPath: string, prNumber: number): PullRequestMapping | undefined {
    return this.pullRequests.get(this.prKey(projectPath, prNumber))
  }
}
