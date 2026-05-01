/**
 * onedev/webhooks.ts
 *
 * Webhook signature verification and event routing.
 *
 * OneDev sends webhooks with a secret token in the X-OneDev-Token header.
 * This is much simpler than GitHub's HMAC-SHA256 — it's a direct string
 * comparison against the configured ONEDEV_WEBHOOK_SECRET.
 */

import type { FastifyRequest } from 'fastify'
import type { OneDevWebhookEnvelope, OneDevEventType } from './types.js'

export class WebhookVerificationError extends Error {}

/**
 * Verifies the incoming request is from our configured OneDev instance.
 * Throws WebhookVerificationError if the token is missing or doesn't match.
 */
export function verifyWebhook(request: FastifyRequest, secret: string): void {
  const token = request.headers['x-onedev-token']
  if (token === undefined || token === '') {
    throw new WebhookVerificationError('Missing X-OneDev-Token header')
  }
  if (token !== secret) {
    throw new WebhookVerificationError('Invalid webhook token')
  }
}

/**
 * Parses the raw webhook body into a typed envelope.
 * Returns null if the event type is one we don't handle.
 */
export function parseWebhook(body: unknown): OneDevWebhookEnvelope | null {
  if (typeof body !== 'object' || body === null) return null

  const raw = body as Record<string, unknown>
  const event = raw['event'] as OneDevEventType | undefined
  if (event === undefined) return null

  const handled: OneDevEventType[] = [
    'IssueOpened',
    'IssueChanged',
    'IssueClosed',
    'IssueReopened',
    'IssueCommentCreated',
    'IssueCommentChanged',
    'IssueCommentDeleted',
    'PullRequestOpened',
    'PullRequestChanged',
    'PullRequestMerged',
    'PullRequestDiscarded',
    'PullRequestCommentCreated',
    'PullRequestCommentChanged',
    'PullRequestCommentDeleted',
  ]

  if (!handled.includes(event)) return null

  return { event, data: raw['data'] }
}
