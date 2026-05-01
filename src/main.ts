/**
 * main.ts
 *
 * Service entry point.
 *
 * - Starts the Fastify HTTP server
 * - Registers the /webhook endpoint (inbound OneDev → Huly)
 * - Starts the Worker (outbound Huly → OneDev)
 * - Handles graceful shutdown
 *
 * Mirrors the main.ts pattern from pod-github / pod-calendar.
 */

import Fastify, { type FastifyBaseLogger } from 'fastify'
import { loadConfig } from './config.js'
import { HulyClient } from './huly/client.js'
import { OneDevClient } from './onedev/client.js'
import { MappingStore, type ProjectConfig } from './huly/mapping.js'
import { Worker } from './worker.js'
import { verifyWebhook, parseWebhook, WebhookVerificationError } from './onedev/webhooks.js'
import type {
  OneDevIssueEvent,
  OneDevIssueCommentEvent,
  OneDevPullRequestEvent,
} from './onedev/types.js'

async function main (): Promise<void> {
  const config = loadConfig()

  const fastify = Fastify({ logger: true })
  const huly = new HulyClient()
  const mappings = new MappingStore()

  // OneDev client factory — creates per-project clients using stored project config.
  // The default instance below is for health checks; per-event clients come from mappings.
  const onedev = new OneDevClient({
    baseUrl: process.env.ONEDEV_BASE_URL ?? 'http://localhost:6610',
    accessToken: process.env.ONEDEV_ACCESS_TOKEN ?? '',
  })

  // Load project configs from ONEDEV_PROJECTS env var (JSON array of ProjectConfig).
  // This is the bootstrap path for simple deployments. The full UI-driven config
  // (FR-3.1) will come from the Huly settings plugin once model-onedev exists.
  loadProjectConfigsFromEnv(mappings)

  const worker = new Worker(config, huly, onedev, mappings)

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: config.serviceId,
      connected: huly.isConnected(),
    }
  })

  // ---------------------------------------------------------------------------
  // Project config management API (internal — not exposed to the internet)
  // ---------------------------------------------------------------------------

  fastify.get('/projects', async () => {
    return mappings.listProjectConfigs().map((p) => ({
      onedevProjectPath: p.onedevProjectPath,
      onedevBaseUrl: p.onedevBaseUrl,
      hulyWorkspace: p.hulyWorkspace,
      hulyProjectIdentifier: p.hulyProjectIdentifier,
      stateMappingCount: p.stateMapping.length,
    }))
  })

  fastify.post('/projects', async (request, reply) => {
    const body = request.body as ProjectConfig
    if (
      typeof body?.onedevProjectPath !== 'string' ||
      typeof body?.onedevBaseUrl !== 'string' ||
      typeof body?.onedevAccessToken !== 'string' ||
      typeof body?.hulyWorkspace !== 'string' ||
      typeof body?.hulyProjectIdentifier !== 'string'
    ) {
      return reply.code(400).send({ error: 'Invalid project config' })
    }

    mappings.setProjectConfig(body)
    await worker.addProject(body)
    fastify.log.info({ msg: 'Project config registered', path: body.onedevProjectPath })
    return reply.code(201).send({ status: 'ok' })
  })

  fastify.delete('/projects/:path', async (request, reply) => {
    const { path } = request.params as { path: string }
    const projectPath = decodeURIComponent(path)
    const existing = mappings.getProjectConfig(projectPath)
    if (existing === undefined) {
      return reply.code(404).send({ error: 'Project not found' })
    }
    await worker.removeProject(existing)
    mappings.deleteProjectConfig(projectPath)
    fastify.log.info({ msg: 'Project config removed', path: projectPath })
    return { status: 'ok' }
  })

  // ---------------------------------------------------------------------------
  // OneDev webhook receiver
  // ---------------------------------------------------------------------------

  fastify.post('/webhook', async (request, reply) => {
    // Verify authenticity — reject fast, respond async
    try {
      verifyWebhook(request, config.onedevWebhookSecret)
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        fastify.log.warn({ msg: 'Rejected webhook', reason: (err as Error).message })
        return reply.code(401).send({ error: (err as Error).message })
      }
      throw err
    }

    const envelope = parseWebhook(request.body)
    if (envelope === null) {
      return reply.code(200).send({ status: 'ignored' })
    }

    // Acknowledge immediately; process asynchronously (NFR-2.1)
    void reply.code(200).send({ status: 'accepted' })

    handleWebhookEvent(envelope.event, envelope.data, { huly, onedev, mappings, config, log: fastify.log })
      .catch((err) => fastify.log.error({ msg: 'Webhook processing failed', event: envelope.event, err }))
  })

  // ---------------------------------------------------------------------------
  // Connect to Huly and start worker
  // ---------------------------------------------------------------------------

  try {
    await huly.connect(config.accountsUrl, config.serverSecret)

    // Load persisted mappings for each configured workspace
    const workspaces = [...new Set(mappings.listProjectConfigs().map((p) => p.hulyWorkspace))]
    for (const ws of workspaces) {
      await huly.loadMappingsForWorkspace(ws, mappings)
    }

    await worker.start()
  } catch (err) {
    fastify.log.error({ msg: 'Failed to connect to Huly', err })
    process.exit(1)
  }

  // ---------------------------------------------------------------------------
  // Start HTTP server
  // ---------------------------------------------------------------------------

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  fastify.log.info({ msg: `pod-onedev listening on port ${config.port}` })

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = async (): Promise<void> => {
    fastify.log.info('Shutting down...')
    await worker.stop()
    await huly.close()
    await fastify.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })
}

// ---------------------------------------------------------------------------
// Webhook event dispatch
// ---------------------------------------------------------------------------

interface HandlerContext {
  huly: HulyClient
  onedev: OneDevClient
  mappings: MappingStore
  config: ReturnType<typeof loadConfig>
  log: FastifyBaseLogger
}

async function handleWebhookEvent (
  event: string,
  data: unknown,
  ctx: HandlerContext,
): Promise<void> {
  switch (event) {
    case 'IssueOpened':
      return handleIssueOpened(data as OneDevIssueEvent, ctx)
    case 'IssueChanged':
    case 'IssueClosed':
    case 'IssueReopened':
      return handleIssueChanged(data as OneDevIssueEvent, ctx)
    case 'IssueCommentCreated':
      return handleIssueCommentCreated(data as OneDevIssueCommentEvent, ctx)
    case 'IssueCommentChanged':
      return handleIssueCommentChanged(data as OneDevIssueCommentEvent, ctx)
    case 'IssueCommentDeleted':
      return handleIssueCommentDeleted(data as OneDevIssueCommentEvent, ctx)
    case 'PullRequestOpened':
    case 'PullRequestChanged':
    case 'PullRequestMerged':
    case 'PullRequestDiscarded':
      return handlePullRequestEvent(data as OneDevPullRequestEvent, ctx)
    default:
      ctx.log.debug({ msg: 'Unhandled event', event })
  }
}

// ---------------------------------------------------------------------------
// Issue handlers
// ---------------------------------------------------------------------------

async function handleIssueOpened (data: OneDevIssueEvent, ctx: HandlerContext): Promise<void> {
  const { issue } = data

  const projectConfig = ctx.mappings.getProjectConfig(issue.project.path)
  if (projectConfig === undefined) {
    ctx.log.debug({ msg: 'No project mapping', path: issue.project.path })
    return
  }

  // Idempotency: skip if already mapped (e.g. duplicate delivery)
  if (ctx.mappings.getIssueByOneDev(issue.project.path, issue.number) !== undefined) {
    ctx.log.debug({ msg: 'Issue already mapped', project: issue.project.path, number: issue.number })
    return
  }

  const onedevUrl = `${projectConfig.onedevBaseUrl}/${issue.project.path}/issues/${issue.number}`

  const hulyIssueId = await ctx.huly.createIssue({
    workspaceId: projectConfig.hulyWorkspace,
    projectIdentifier: projectConfig.hulyProjectIdentifier,
    title: issue.title,
    description: issue.description,
    externalUrl: onedevUrl,
  })

  const issueMapping = {
    onedevProjectPath: issue.project.path,
    onedevIssueNumber: issue.number,
    onedevIssueId: issue.id,
    hulyWorkspace: projectConfig.hulyWorkspace,
    hulyProjectIdentifier: projectConfig.hulyProjectIdentifier,
    hulyIssueId,
  }
  ctx.mappings.setIssue(issueMapping)
  ctx.huly.persistIssueMapping(projectConfig.hulyWorkspace, issueMapping)
    .catch((err) => ctx.log.error({ msg: 'Failed to persist issue mapping', err }))

  ctx.log.info({ msg: 'Created Huly issue', hulyIssueId, project: issue.project.path, number: issue.number })
}

async function handleIssueChanged (data: OneDevIssueEvent, ctx: HandlerContext): Promise<void> {
  const { issue } = data

  const mapping = ctx.mappings.getIssueByOneDev(issue.project.path, issue.number)
  if (mapping === undefined) return

  const update: { title?: string; description?: string; status?: string } = {
    title: issue.title,
    description: issue.description,
  }

  // Resolve state → Huly status if the mapping has a rule for it
  const hulyStatusId = ctx.mappings.resolveHulyStatus(issue.project.path, issue.state)
  if (hulyStatusId !== undefined) {
    update.status = hulyStatusId
  }

  await ctx.huly.updateIssue(mapping.hulyWorkspace, mapping.hulyIssueId, update)
  ctx.log.info({ msg: 'Updated Huly issue', hulyIssueId: mapping.hulyIssueId, state: issue.state })
}

// ---------------------------------------------------------------------------
// Comment handlers
// ---------------------------------------------------------------------------

async function handleIssueCommentCreated (data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { issue, comment } = data

  // Skip our own comments to avoid sync loops (FR-2.6)
  if (comment.content.includes('<!-- pod-onedev -->')) return

  const mapping = ctx.mappings.getIssueByOneDev(issue.project.path, issue.number)
  if (mapping === undefined) return

  const hulyCommentId = await ctx.huly.createComment({
    workspaceId: mapping.hulyWorkspace,
    issueId: mapping.hulyIssueId,
    text: comment.content,
  })

  const commentMapping = {
    onedevCommentId: comment.id,
    hulyCommentId,
    hulyWorkspace: mapping.hulyWorkspace,
  }
  ctx.mappings.setComment(commentMapping)
  ctx.huly.persistCommentMapping(mapping.hulyWorkspace, commentMapping)
    .catch((err) => ctx.log.error({ msg: 'Failed to persist comment mapping', err }))

  ctx.log.info({ msg: 'Created Huly comment', hulyCommentId, onedevCommentId: comment.id })
}

async function handleIssueCommentChanged (data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { comment } = data

  const mapping = ctx.mappings.getCommentByOneDev(comment.id)
  if (mapping === undefined) return

  await ctx.huly.updateComment(mapping.hulyWorkspace, mapping.hulyCommentId, comment.content)
  ctx.log.info({ msg: 'Updated Huly comment', hulyCommentId: mapping.hulyCommentId })
}

async function handleIssueCommentDeleted (data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { comment } = data

  const mapping = ctx.mappings.getCommentByOneDev(comment.id)
  if (mapping === undefined) return

  await ctx.huly.deleteComment(mapping.hulyWorkspace, mapping.hulyCommentId)
  ctx.mappings.deleteComment(comment.id)
  ctx.huly.removePersistentCommentMapping(mapping.hulyWorkspace, comment.id)
    .catch((err) => ctx.log.error({ msg: 'Failed to remove comment mapping', err }))
  ctx.log.info({ msg: 'Deleted Huly comment', hulyCommentId: mapping.hulyCommentId })
}

// ---------------------------------------------------------------------------
// Pull request handler
// ---------------------------------------------------------------------------

async function handlePullRequestEvent (data: OneDevPullRequestEvent, ctx: HandlerContext): Promise<void> {
  const { pullRequest } = data

  const projectConfig = ctx.mappings.getProjectConfig(pullRequest.project.path)
  if (projectConfig === undefined) return

  ctx.log.info({
    msg: 'Pull request event',
    project: pullRequest.project.path,
    number: pullRequest.number,
    state: pullRequest.state,
  })

  // When a PR merges, transition any linked issue to the "done" state if configured.
  if (pullRequest.state === 'MERGED') {
    // TODO: resolve the linked OneDev issue from the PR description/title and
    // transition it — requires parsing OneDev's issue reference syntax.
    ctx.log.info({ msg: 'PR merged — issue auto-close not yet implemented' })
  }

  // TODO: create/update a Huly pull request document once model-onedev defines the class.
}

// ---------------------------------------------------------------------------
// Bootstrap helpers
// ---------------------------------------------------------------------------

/**
 * Seed project configs from the ONEDEV_PROJECTS environment variable.
 * Value must be a JSON array of ProjectConfig objects.
 * Example:
 *   ONEDEV_PROJECTS='[{"onedevProjectPath":"acme/backend","onedevBaseUrl":"https://onedev.example.com","onedevAccessToken":"tok","hulyWorkspace":"my-ws","hulyProjectIdentifier":"BACK","stateMapping":[]}]'
 */
function loadProjectConfigsFromEnv (store: MappingStore): void {
  const raw = process.env.ONEDEV_PROJECTS
  if (raw === undefined || raw === '') return

  let configs: ProjectConfig[]
  try {
    configs = JSON.parse(raw) as ProjectConfig[]
  } catch {
    console.error('[config] Failed to parse ONEDEV_PROJECTS — must be a JSON array')
    return
  }

  for (const c of configs) {
    store.setProjectConfig(c)
    console.log(`[config] Loaded project config: ${c.onedevProjectPath} → ${c.hulyWorkspace}/${c.hulyProjectIdentifier}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
