# pod-onedev

Bridge service between OneDev (git/issue host) and Huly (project management).
Standalone now, intended for upstream contribution to `hcengineering/platform`
as `services/onedev/pod-onedev/`.

## What this service does

- **Inbound (OneDev → Huly):** receives OneDev webhooks, creates/updates Huly issues and PRs
- **Outbound (Huly → OneDev):** watches Huly change feed, reflects changes back to OneDev REST API
- Runs as a Docker container alongside the Huly stack on `huly_net`

## Reference implementation

`pod-github` in `hcengineering/platform` at `services/github/pod-github/` is the
direct model for this service. Read it for patterns, do not depend on it.

Sparse clone for reference:
```
git clone --filter=blob:none --sparse https://github.com/hcengineering/platform platform-ref
cd platform-ref && git sparse-checkout set services/github/pod-github models/github plugins/github
```

## Key differences from pod-github

| Concern | pod-github | pod-onedev |
|---|---|---|
| Auth to external service | GitHub App JWT + installation tokens | Plain bearer token (`ONEDEV_ACCESS_TOKEN`) |
| Webhook verification | HMAC-SHA256 (`X-Hub-Signature-256`) | Token header comparison (`X-OneDev-Token`) |
| OAuth install flow | Yes (GitHub App install) | No — Authentik handles SSO |
| front env vars needed | `GITHUB_URL`, `GITHUB_APP`, `GITHUB_CLIENTID` | `ONEDEV_URL` only |
| Nginx route | `/_github` | `/_onedev` |
| Port | 3500 | 3600 |

## Internal Huly connections

Same as every other pod service:
- `account:3000` — JWT verification, workspace membership
- transactor (WebSocket) — read/write Huly documents via `@hcengineering/api-client`
- `collaborator` — real-time change feed
- `stats:4900` — metrics
- `minio` — blob/attachment storage

## Source layout

```
src/
  config.ts          # env var parsing — add new vars here
  main.ts            # Fastify server, webhook receiver, startup/shutdown
  worker.ts          # Huly change feed watcher → OneDev REST
  onedev/
    types.ts         # OneDev webhook payload types (inline for now; will become model-onedev)
    client.ts        # OneDev REST API wrapper
    webhooks.ts      # webhook verification + event routing
  huly/
    client.ts        # @hcengineering/api-client wrapper (stubs to implement)
    mapping.ts       # OneDev ID ↔ Huly Doc ID store (in-memory; needs persistence)
```

## What's stubbed / needs implementing

1. `huly/client.ts` — all methods are stubs pending `@hcengineering/api-client` install
2. `huly/mapping.ts` — in-memory only; needs persistence via Huly documents
3. `main.ts` handler functions — skeleton exists, logic to be filled in
4. Project mapping config — how a user connects a OneDev project to a Huly project

## Build

```bash
npm install
npm run build       # tsc
npm run dev         # ts-node src/main.ts
npm run typecheck   # tsc --noEmit
docker build -t pod-onedev .
docker compose -f docker-compose.dev.yml up
```

## Requirements

Full requirements: `docs/pod-onedev-requirements.md`

## Upstreaming checklist

When ready to upstream into `hcengineering/platform`:
- [ ] Extract `src/onedev/types.ts` → `models/onedev/` as `@hcengineering/model-onedev`
- [ ] Add UI settings panel to `plugins/onedev/`
- [ ] Register in `models/all/src/index.ts`
- [ ] Add entry to `rush.json`
- [ ] Add to `dev/docker-compose.yaml`
- [ ] Add nginx route to `.huly.nginx`
- [ ] Open PR against `develop` branch
