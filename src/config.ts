/**
 * config.ts
 *
 * Parses and validates all environment variables at startup.
 * Mirrors the pattern used by other Huly pod services.
 * See docs/pod-onedev-requirements.md for full env var reference.
 */

function required(name: string): string {
  const val = process.env[name]
  if (val === undefined || val === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return val
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

export interface Config {
  // ---- Service identity ----
  port: number
  serviceId: string

  // ---- Huly internal connections ----
  serverSecret: string
  accountsUrl: string
  statsUrl: string
  storageConfig: string
  collaboratorUrl: string

  // ---- Public-facing ----
  frontUrl: string

  // ---- OneDev ----
  onedevWebhookSecret: string

  // ---- Sync behaviour ----
  /** How often (ms) to poll Huly for outbound changes. Default: 30 000. */
  hulyPollIntervalMs: number
}

export function loadConfig(): Config {
  return {
    port: parseInt(optional('PORT', '3600'), 10),
    serviceId: optional('SERVICE_ID', 'onedev-service'),

    serverSecret: required('SERVER_SECRET'),
    accountsUrl: required('ACCOUNTS_URL'),
    statsUrl: required('STATS_URL'),
    storageConfig: required('STORAGE_CONFIG'),
    collaboratorUrl: required('COLLABORATOR_URL'),

    frontUrl: required('FRONT_URL'),

    onedevWebhookSecret: required('ONEDEV_WEBHOOK_SECRET'),

    hulyPollIntervalMs: parseInt(optional('HULY_POLL_INTERVAL_MS', '30000'), 10),
  }
}
