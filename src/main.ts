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

import Fastify from 'fastify'
import { loadConfig } from './config.js'
import { HulyClient } from './huly/client.js'
import { OneDevClient } from './onedev/client.js'
import { MappingStore } from './huly/mapping.js'
import { Worker } from './worker.js'
import { verifyWebhook, parseWebhook, WebhookVerificationError } from './onedev/webhooks.js'
import type {
  OneDevIssueEvent,
  OneDevIssueCommentEvent,
  OneDevPullRequestEvent,
} from './onedev/types.js'

async function main(): Promise<void> {
  const config = loadConfig()

  const fastify = Fastify({ logger: true })
  const huly = new HulyClient()
  const mappings = new MappingStore()

  // OneDev client is configured per-workspace in practice;
  // this default instance is for dev/testing.
  const onedev = new OneDevClient({
    baseUrl: process.env.ONEDEV_BASE_URL ?? 'http://localhost:6610',
    accessToken: process.env.ONEDEV_ACCESS_TOKEN ?? '',
  })

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
  // OneDev webhook receiver
  // ---------------------------------------------------------------------------

  fastify.post('/webhook', async (request, reply) => {
    // Verify authenticity — reject fast, respond async
    try {
      verifyWebhook(request, config.onedevWebhookSecret)
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        fastify.log.warn({ msg: 'Rejected webhook', reason: err.message })
        return reply.code(401).send({ error: err.message })
      }
      throw err
    }

    const envelope = parseWebhook(request.body)
    if (envelope === null) {
      // Unknown or unhandled event — acknowledge and ignore
      return reply.code(200).send({ status: 'ignored' })
    }

    // Acknowledge immediately; process asynchronously
    // Per NFR-2.1: webhook endpoint must return 200 quickly
    reply.code(200).send({ status: 'accepted' })

    // Process in background
    handleWebhookEvent(envelope.event, envelope.data, { huly, onedev, mappings, config, log: fastify.log })
      .catch((err) => fastify.log.error({ msg: 'Webhook processing failed', event: envelope.event, err }))

    return reply
  })

  // ---------------------------------------------------------------------------
  // Connect to Huly and start worker
  // ---------------------------------------------------------------------------

  try {
    await huly.connect(config.accountsUrl, config.serverSecret)
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

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// ---------------------------------------------------------------------------
// Webhook event dispatch
// ---------------------------------------------------------------------------

interface HandlerContext {
  huly: HulyClient
  onedev: OneDevClient
  mappings: MappingStore
  config: ReturnType<typeof loadConfig>
  log: ReturnType<typeof Fastify>['log']
}

async function handleWebhookEvent(
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
// Individual event handlers — stubs to be implemented
// ---------------------------------------------------------------------------

async function handleIssueOpened(data: OneDevIssueEvent, ctx: HandlerContext): Promise<void> {
  const { issue } = data
  ctx.log.info({ msg: 'Issue opened', project: issue.project.path, number: issue.number })
  // TODO: check if project is mapped, create Huly issue, store mapping
}

async function handleIssueChanged(data: OneDevIssueEvent, ctx: HandlerContext): Promise<void> {
  const { issue } = data
  const mapping = ctx.mappings.getIssueByOneDev(issue.project.path, issue.number)
  if (mapping === undefined) return

  ctx.log.info({ msg: 'Issue changed', project: issue.project.path, number: issue.number })
  // TODO: update Huly issue title/description/status
}

async function handleIssueCommentCreated(data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { issue, comment } = data
  // Skip comments that we posted to avoid sync loops
  if (comment.content.includes('<!-- pod-onedev -->')) return

  const mapping = ctx.mappings.getIssueByOneDev(issue.project.path, issue.number)
  if (mapping === undefined) return

  ctx.log.info({ msg: 'Issue comment created', issueNumber: issue.number, commentId: comment.id })
  // TODO: create comment in Huly, store comment mapping
}

async function handleIssueCommentChanged(data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { comment } = data
  const mapping = ctx.mappings.getCommentByOneDev(comment.id)
  if (mapping === undefined) return

  // TODO: update Huly comment
}

async function handleIssueCommentDeleted(data: OneDevIssueCommentEvent, ctx: HandlerContext): Promise<void> {
  const { comment } = data
  const mapping = ctx.mappings.getCommentByOneDev(comment.id)
  if (mapping === undefined) return

  // TODO: delete Huly comment, remove mapping
  ctx.mappings.deleteComment(comment.id)
}

async function handlePullRequestEvent(data: OneDevPullRequestEvent, ctx: HandlerContext): Promise<void> {
  const { pullRequest } = data
  ctx.log.info({ msg: 'Pull request event', project: pullRequest.project.path, number: pullRequest.number, state: pullRequest.state })
  // TODO: create/update/close PR document in Huly
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
