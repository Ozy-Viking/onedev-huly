/**
 * huly/mapping.ts
 *
 * Bidirectional ID mapping between OneDev entities and Huly documents,
 * plus project-level configuration (which OneDev project maps to which
 * Huly workspace/project, and how states map).
 *
 * Currently in-memory. Persistence via Huly documents is tracked as a
 * follow-on task — see FR-4.1 in docs/pod-onedev-requirements.md.
 */

// ---------------------------------------------------------------------------
// Project configuration
// ---------------------------------------------------------------------------

export interface StateMapping {
  /** OneDev issue state name, e.g. "Open" */
  onedevState: string
  /** Huly issue status Ref string, e.g. "tracker:status:InProgress" */
  hulyStatusId: string
}

/**
 * Connects a OneDev project to a Huly workspace + project.
 * Stored by OneDev project path (e.g. "acme/backend").
 */
export interface ProjectConfig {
  onedevProjectPath: string
  /** OneDev base URL for this project, e.g. https://onedev.example.com */
  onedevBaseUrl: string
  /** OneDev personal access token scoped to this project */
  onedevAccessToken: string
  /** Huly workspace URL slug, e.g. "my-workspace" */
  hulyWorkspace: string
  /** Huly tracker project identifier shown in the UI, e.g. "BACK" */
  hulyProjectIdentifier: string
  /** Maps OneDev states → Huly status IDs */
  stateMapping: StateMapping[]
}

// ---------------------------------------------------------------------------
// Entity mappings
// ---------------------------------------------------------------------------

export interface IssueMapping {
  onedevProjectPath: string
  onedevIssueNumber: number
  onedevIssueId: number
  hulyWorkspace: string
  hulyProjectIdentifier: string
  hulyIssueId: string   // Ref<tracker.class.Issue>
}

export interface CommentMapping {
  onedevCommentId: number
  hulyCommentId: string  // Ref<chunter.class.ChatMessage>
  hulyWorkspace: string
}

export interface PullRequestMapping {
  onedevProjectPath: string
  onedevPrNumber: number
  onedevPrId: number
  hulyWorkspace: string
  hulyPrId: string
}

// ---------------------------------------------------------------------------
// MappingStore
// ---------------------------------------------------------------------------

export class MappingStore {
  private readonly projects = new Map<string, ProjectConfig>()
  private readonly issues = new Map<string, IssueMapping>()
  private readonly issuesByHuly = new Map<string, IssueMapping>()
  private readonly comments = new Map<string, CommentMapping>()
  private readonly pullRequests = new Map<string, PullRequestMapping>()

  // ---- Project config ----

  setProjectConfig (config: ProjectConfig): void {
    this.projects.set(config.onedevProjectPath, config)
  }

  getProjectConfig (onedevProjectPath: string): ProjectConfig | undefined {
    return this.projects.get(onedevProjectPath)
  }

  listProjectConfigs (): ProjectConfig[] {
    return [...this.projects.values()]
  }

  deleteProjectConfig (onedevProjectPath: string): void {
    this.projects.delete(onedevProjectPath)
  }

  /** Resolve OneDev state name to a Huly status ID using the project's state mapping. */
  resolveHulyStatus (onedevProjectPath: string, onedevState: string): string | undefined {
    const config = this.projects.get(onedevProjectPath)
    if (config === undefined) return undefined
    return config.stateMapping.find((m) => m.onedevState === onedevState)?.hulyStatusId
  }

  // ---- Issue mappings ----

  issueKey (projectPath: string, issueNumber: number): string {
    return `${projectPath}:${issueNumber}`
  }

  setIssue (mapping: IssueMapping): void {
    const key = this.issueKey(mapping.onedevProjectPath, mapping.onedevIssueNumber)
    this.issues.set(key, mapping)
    this.issuesByHuly.set(mapping.hulyIssueId, mapping)
  }

  getIssueByOneDev (projectPath: string, issueNumber: number): IssueMapping | undefined {
    return this.issues.get(this.issueKey(projectPath, issueNumber))
  }

  getIssueByHuly (hulyIssueId: string): IssueMapping | undefined {
    return this.issuesByHuly.get(hulyIssueId)
  }

  deleteIssue (projectPath: string, issueNumber: number): void {
    const key = this.issueKey(projectPath, issueNumber)
    const mapping = this.issues.get(key)
    if (mapping !== undefined) {
      this.issuesByHuly.delete(mapping.hulyIssueId)
      this.issues.delete(key)
    }
  }

  // ---- Comment mappings ----

  setComment (mapping: CommentMapping): void {
    this.comments.set(String(mapping.onedevCommentId), mapping)
  }

  getCommentByOneDev (commentId: number): CommentMapping | undefined {
    return this.comments.get(String(commentId))
  }

  deleteComment (commentId: number): void {
    this.comments.delete(String(commentId))
  }

  // ---- Pull request mappings ----

  prKey (projectPath: string, prNumber: number): string {
    return `pr:${projectPath}:${prNumber}`
  }

  setPullRequest (mapping: PullRequestMapping): void {
    this.pullRequests.set(this.prKey(mapping.onedevProjectPath, mapping.onedevPrNumber), mapping)
  }

  getPullRequestByOneDev (projectPath: string, prNumber: number): PullRequestMapping | undefined {
    return this.pullRequests.get(this.prKey(projectPath, prNumber))
  }

  deletePullRequest (projectPath: string, prNumber: number): void {
    this.pullRequests.delete(this.prKey(projectPath, prNumber))
  }
}
