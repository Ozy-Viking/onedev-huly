#!/usr/bin/env node
/**
 * cli.ts — pod-onedev connection management
 *
 * Manages OneDev ↔ Huly project connections by calling the pod-onedev
 * HTTP API. Run inside the container or against an exposed port.
 *
 * Usage:
 *   pod-onedev-cli list
 *   pod-onedev-cli add --onedev-path <path> --onedev-url <url> --token <tok> \
 *                      --workspace <ws> --project <identifier> \
 *                      [--state-map <onedevState>:<hulyStatusId> ...]
 *   pod-onedev-cli remove --onedev-path <path>
 *
 * Options:
 *   --url   Base URL of the pod-onedev service (default: http://localhost:3600,
 *           or POD_ONEDEV_URL env var)
 *
 * Examples:
 *   pod-onedev-cli list
 *   pod-onedev-cli add \
 *     --onedev-path acme/backend \
 *     --onedev-url https://onedev.example.com \
 *     --token pat_xxxx \
 *     --workspace my-workspace \
 *     --project BACK \
 *     --state-map "Open:tracker:status:Todo" \
 *     --state-map "In Progress:tracker:status:InProgress" \
 *     --state-map "Closed:tracker:status:Done"
 *   pod-onedev-cli remove --onedev-path acme/backend
 */

import { parseArgs } from 'node:util'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api (
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, baseUrl)
  const payload = body !== undefined ? JSON.stringify(body) : undefined
  const isHttps = url.protocol === 'https:'
  const req = isHttps ? httpsRequest : request

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }

    const r = req(options, (res) => {
      let raw = ''
      res.on('data', (chunk: Buffer) => { raw += chunk.toString() })
      res.on('end', () => {
        let data: unknown
        try { data = JSON.parse(raw) } catch { data = raw }
        resolve({ status: res.statusCode ?? 0, data })
      })
    })

    r.on('error', reject)
    if (payload !== undefined) r.write(payload)
    r.end()
  })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList (baseUrl: string): Promise<void> {
  const { status, data } = await api(baseUrl, 'GET', '/projects')
  if (status !== 200) {
    console.error(`Error ${status}:`, data)
    process.exit(1)
  }

  const projects = data as Array<{
    onedevProjectPath: string
    onedevBaseUrl: string
    hulyWorkspace: string
    hulyProjectIdentifier: string
    stateMappingCount: number
  }>

  if (projects.length === 0) {
    console.log('No connections configured.')
    return
  }

  console.log(`${'OneDev path'.padEnd(30)}  ${'Huly workspace'.padEnd(20)}  ${'Project'.padEnd(10)}  State maps`)
  console.log('-'.repeat(80))
  for (const p of projects) {
    console.log(
      `${p.onedevProjectPath.padEnd(30)}  ${p.hulyWorkspace.padEnd(20)}  ${p.hulyProjectIdentifier.padEnd(10)}  ${p.stateMappingCount}`,
    )
  }
}

async function cmdAdd (baseUrl: string, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      'onedev-path': { type: 'string' },
      'onedev-url': { type: 'string' },
      'token': { type: 'string' },
      'workspace': { type: 'string' },
      'project': { type: 'string' },
      'state-map': { type: 'string', multiple: true },
    },
    strict: false,
  })

  const onedevPath = values['onedev-path']
  const onedevUrl = values['onedev-url']
  const token = values['token']
  const workspace = values['workspace']
  const project = values['project']

  if (
    typeof onedevPath !== 'string' ||
    typeof onedevUrl !== 'string' ||
    typeof token !== 'string' ||
    typeof workspace !== 'string' ||
    typeof project !== 'string'
  ) {
    console.error('Missing required options: --onedev-path, --onedev-url, --token, --workspace, --project')
    process.exit(1)
  }

  // Parse --state-map "OneDev State:hulyStatusId" pairs
  const rawMaps = values['state-map']
  const rawMapArray: string[] = (Array.isArray(rawMaps) ? rawMaps : rawMaps !== undefined ? [rawMaps] : [])
    .filter((m): m is string => typeof m === 'string')
  const stateMapping = rawMapArray.map((m) => {
    const colon = m.indexOf(':')
    if (colon === -1) {
      console.error(`Invalid --state-map value "${m}" — expected "OneDev State:hulyStatusId"`)
      process.exit(1)
    }
    return {
      onedevState: m.slice(0, colon),
      hulyStatusId: m.slice(colon + 1),
    }
  })

  const body = {
    onedevProjectPath: onedevPath,
    onedevBaseUrl: onedevUrl.replace(/\/$/, ''),
    onedevAccessToken: token,
    hulyWorkspace: workspace,
    hulyProjectIdentifier: project,
    stateMapping,
  }

  const { status, data } = await api(baseUrl, 'POST', '/projects', body)
  if (status === 201) {
    console.log(`✓ Connected ${onedevPath} → ${workspace}/${project}`)
    if (stateMapping.length > 0) {
      console.log(`  State mappings: ${stateMapping.map((m: { onedevState: string; hulyStatusId: string }) => `${m.onedevState} → ${m.hulyStatusId}`).join(', ')}`)
    }
  } else {
    console.error(`Error ${status}:`, data)
    process.exit(1)
  }
}

async function cmdRemove (baseUrl: string, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      'onedev-path': { type: 'string' },
    },
    strict: false,
  })

  const onedevPath = values['onedev-path']
  if (typeof onedevPath !== 'string') {
    console.error('Missing required option: --onedev-path')
    process.exit(1)
  }

  const { status, data } = await api(baseUrl, 'DELETE', `/projects/${encodeURIComponent(onedevPath)}`)
  if (status === 200) {
    console.log(`✓ Removed connection for ${onedevPath}`)
  } else {
    console.error(`Error ${status}:`, data)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main (): Promise<void> {
  const argv = process.argv.slice(2)
  const baseUrl = (process.env.POD_ONEDEV_URL ?? 'http://localhost:3600').replace(/\/$/, '')

  const command = argv[0]
  const rest = argv.slice(1)

  switch (command) {
    case 'list':
      await cmdList(baseUrl)
      break
    case 'add':
      await cmdAdd(baseUrl, rest)
      break
    case 'remove':
    case 'rm':
      await cmdRemove(baseUrl, rest)
      break
    default:
      console.log(`pod-onedev connection manager

Usage:
  pod-onedev-cli list
  pod-onedev-cli add --onedev-path <path> --onedev-url <url> --token <tok>
                     --workspace <ws> --project <identifier>
                     [--state-map "Open:tracker:status:Todo" ...]
  pod-onedev-cli remove --onedev-path <path>

Environment:
  POD_ONEDEV_URL   Base URL of the pod-onedev service (default: http://localhost:3600)
`)
      process.exit(command === undefined ? 0 : 1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
