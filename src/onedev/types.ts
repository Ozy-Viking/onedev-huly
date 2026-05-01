/**
 * onedev/types.ts
 *
 * TypeScript types for OneDev webhook payloads and REST API responses.
 *
 * NOTE: These are defined inline here for the standalone service.
 * When upstreaming into hcengineering/platform, these will be extracted
 * into a dedicated models/onedev package as @hcengineering/model-onedev.
 *
 * Reference: https://<your-onedev>/~help/api
 */

// ---------------------------------------------------------------------------
// Webhook event types
// ---------------------------------------------------------------------------

export type OneDevEventType =
  | 'IssueOpened'
  | 'IssueChanged'
  | 'IssueClosed'
  | 'IssueReopened'
  | 'IssueCommentCreated'
  | 'IssueCommentChanged'
  | 'IssueCommentDeleted'
  | 'PullRequestOpened'
  | 'PullRequestChanged'
  | 'PullRequestMerged'
  | 'PullRequestDiscarded'
  | 'PullRequestCommentCreated'
  | 'PullRequestCommentChanged'
  | 'PullRequestCommentDeleted'

export interface OneDevWebhookEnvelope {
  event: OneDevEventType
  data: unknown
}

// ---------------------------------------------------------------------------
// Common entities
// ---------------------------------------------------------------------------

export interface OneDevUser {
  id: number
  name: string
  email?: string
  fullName?: string
}

export interface OneDevProject {
  id: number
  name: string
  path: string
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface OneDevIssueField {
  name: string
  value: string | string[] | null
}

export interface OneDevIssue {
  id: number
  number: number
  title: string
  description?: string
  state: string
  project: OneDevProject
  submitter: OneDevUser
  assignees: OneDevUser[]
  fields: OneDevIssueField[]
  submitDate: string
  lastActivity?: string
}

export interface OneDevIssueEvent {
  issue: OneDevIssue
  actor: OneDevUser
}

// ---------------------------------------------------------------------------
// Issue comments
// ---------------------------------------------------------------------------

export interface OneDevIssueComment {
  id: number
  content: string
  user: OneDevUser
  date: string
}

export interface OneDevIssueCommentEvent {
  issue: OneDevIssue
  comment: OneDevIssueComment
  actor: OneDevUser
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export interface OneDevPullRequest {
  id: number
  number: number
  title: string
  description?: string
  state: 'OPEN' | 'MERGED' | 'DISCARDED'
  project: OneDevProject
  submitter: OneDevUser
  sourceBranch: string
  targetBranch: string
  submitDate: string
}

export interface OneDevPullRequestEvent {
  pullRequest: OneDevPullRequest
  actor: OneDevUser
}

// ---------------------------------------------------------------------------
// Pull request comments
// ---------------------------------------------------------------------------

export interface OneDevPullRequestComment {
  id: number
  content: string
  user: OneDevUser
  date: string
}

export interface OneDevPullRequestCommentEvent {
  pullRequest: OneDevPullRequest
  comment: OneDevPullRequestComment
  actor: OneDevUser
}
