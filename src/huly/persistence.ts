/**
 * huly/persistence.ts
 *
 * Persists OneDev↔Huly ID mappings as documents in the Huly transactor.
 *
 * Documents are stored with class IDs prefixed `onedev:class:` in
 * `core:space:Configuration` (a system space present in every workspace).
 * The class IDs are not registered in the Huly model yet — that requires
 * @hcengineering/model-onedev (tracked in the upstreaming checklist).
 * The transactor accepts and indexes documents with any class string, so
 * queries work correctly even without a model entry.
 */

import { generateId } from '@hcengineering/core'
import type { Ref, Doc, TxOperations } from '@hcengineering/core'
import type { IssueMapping, CommentMapping, PullRequestMapping } from './mapping.js'

// ---------------------------------------------------------------------------
// Class and space IDs
// ---------------------------------------------------------------------------

const ONEDEV_ISSUE_MAPPING_CLASS = 'onedev:class:IssueMapping' as Ref<Doc>
const ONEDEV_COMMENT_MAPPING_CLASS = 'onedev:class:CommentMapping' as Ref<Doc>
const ONEDEV_PR_MAPPING_CLASS = 'onedev:class:PullRequestMapping' as Ref<Doc>

// core:space:Configuration is present in every Huly workspace and accepts
// arbitrary service-level documents.
const CONFIGURATION_SPACE = 'core:space:Configuration' as Ref<Doc>

// ---------------------------------------------------------------------------
// Load helpers (called at service startup)
// ---------------------------------------------------------------------------

export async function loadIssueMappings (ops: TxOperations): Promise<IssueMapping[]> {
  const docs = await ops.findAll(
    ONEDEV_ISSUE_MAPPING_CLASS as any,
    {},
  )
  return docs.map((d: any) => ({
    onedevProjectPath: d.onedevProjectPath,
    onedevIssueNumber: d.onedevIssueNumber,
    onedevIssueId: d.onedevIssueId,
    hulyWorkspace: d.hulyWorkspace,
    hulyProjectIdentifier: d.hulyProjectIdentifier,
    hulyIssueId: d.hulyIssueId,
  }))
}

export async function loadCommentMappings (ops: TxOperations): Promise<CommentMapping[]> {
  const docs = await ops.findAll(
    ONEDEV_COMMENT_MAPPING_CLASS as any,
    {},
  )
  return docs.map((d: any) => ({
    onedevCommentId: d.onedevCommentId,
    hulyCommentId: d.hulyCommentId,
    hulyWorkspace: d.hulyWorkspace,
  }))
}

export async function loadPullRequestMappings (ops: TxOperations): Promise<PullRequestMapping[]> {
  const docs = await ops.findAll(
    ONEDEV_PR_MAPPING_CLASS as any,
    {},
  )
  return docs.map((d: any) => ({
    onedevProjectPath: d.onedevProjectPath,
    onedevPrNumber: d.onedevPrNumber,
    onedevPrId: d.onedevPrId,
    hulyWorkspace: d.hulyWorkspace,
    hulyPrId: d.hulyPrId,
  }))
}

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

export async function saveIssueMapping (ops: TxOperations, mapping: IssueMapping): Promise<string> {
  const id = generateId()
  await ops.createDoc(
    ONEDEV_ISSUE_MAPPING_CLASS as any,
    CONFIGURATION_SPACE as any,
    mapping as any,
    id as Ref<Doc>,
  )
  return id
}

export async function saveCommentMapping (ops: TxOperations, mapping: CommentMapping): Promise<string> {
  const id = generateId()
  await ops.createDoc(
    ONEDEV_COMMENT_MAPPING_CLASS as any,
    CONFIGURATION_SPACE as any,
    mapping as any,
    id as Ref<Doc>,
  )
  return id
}

export async function savePullRequestMapping (ops: TxOperations, mapping: PullRequestMapping): Promise<string> {
  const id = generateId()
  await ops.createDoc(
    ONEDEV_PR_MAPPING_CLASS as any,
    CONFIGURATION_SPACE as any,
    mapping as any,
    id as Ref<Doc>,
  )
  return id
}

// ---------------------------------------------------------------------------
// Delete helpers (find doc by mapping fields, then remove)
// ---------------------------------------------------------------------------

export async function deleteIssueMappingDoc (
  ops: TxOperations,
  onedevProjectPath: string,
  onedevIssueNumber: number,
): Promise<void> {
  const doc = await ops.findOne(
    ONEDEV_ISSUE_MAPPING_CLASS as any,
    { onedevProjectPath, onedevIssueNumber } as any,
  )
  if (doc === undefined) return
  await ops.removeDoc(
    ONEDEV_ISSUE_MAPPING_CLASS as any,
    CONFIGURATION_SPACE as any,
    doc._id as Ref<Doc>,
  )
}

export async function deleteCommentMappingDoc (ops: TxOperations, onedevCommentId: number): Promise<void> {
  const doc = await ops.findOne(
    ONEDEV_COMMENT_MAPPING_CLASS as any,
    { onedevCommentId } as any,
  )
  if (doc === undefined) return
  await ops.removeDoc(
    ONEDEV_COMMENT_MAPPING_CLASS as any,
    CONFIGURATION_SPACE as any,
    doc._id as Ref<Doc>,
  )
}
