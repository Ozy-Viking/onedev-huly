# pod-onedev Requirements

Service that bridges OneDev and Huly, modelled on `pod-github` (`services/github/pod-github`
in `hcengineering/platform`).

---

## 1. Context

### What pod-github teaches us

`pod-github` touches the following services outside its own container:

| Service | How |
|---|---|
| `account:3000` | Verifies user JWTs, resolves workspace membership |
| `transactor` | Reads/writes Huly documents via `@hcengineering/api-client` over WebSocket |
| `collaborator` | WebSocket connection for real-time document change feed |
| `stats:4900` | Metrics reporting |
| `minio` | Stores file attachments synced from GitHub issues |
| `front` (env vars) | Browser needs `GITHUB_URL`, `GITHUB_APP`, `GITHUB_CLIENTID` to drive OAuth/install flow |
| `nginx` | `/_github` proxied to `github:3500` so GitHub can reach the webhook endpoint |

### What's different for OneDev

- No GitHub App model — no JWT signing, no installation access tokens, no app slug
- Auth to OneDev is a plain bearer token (personal access token)
- No "Install App" UI flow — user configures a webhook in OneDev and a token in Huly settings
- Authentik handles SSO; `pod-onedev` does not participate in user authentication
- `front` needs fewer env vars — no `ONEDEV_APP` or `ONEDEV_CLIENTID` equivalent
- OneDev webhook payloads and entity shapes differ from GitHub's

---

## 2. Functional Requirements

### FR-1 Inbound sync (OneDev → Huly)

The service MUST expose an HTTP endpoint to receive OneDev webhooks.

| ID | Requirement |
|---|---|
| FR-1.1 | Receive `IssueEvent` webhooks: created, updated, deleted, state changed |
| FR-1.2 | Receive `IssueCommentEvent` webhooks: created, updated, deleted |
| FR-1.3 | Receive `PullRequestEvent` webhooks: opened, updated, merged, discarded |
| FR-1.4 | Receive `PullRequestCommentEvent` webhooks: created, updated, deleted |
| FR-1.5 | Verify webhook authenticity using the configured secret token |
| FR-1.6 | Reject unverified webhook payloads with HTTP 401 |
| FR-1.7 | Map OneDev issues to Huly Tracker issues (title, description, state, assignee, labels) |
| FR-1.8 | Map OneDev pull requests to Huly pull request documents, visible in the PR tab |
| FR-1.9 | Sync issue comments bidirectionally, attributing them to the correct Huly user where possible |
| FR-1.10 | When a OneDev PR is merged, update the linked Huly issue status to the configured "done" state |
| FR-1.11 | Attach the OneDev issue/PR URL as a link on the Huly document |

### FR-2 Outbound sync (Huly → OneDev)

The service MUST watch the Huly transactor change feed and reflect changes back to OneDev.

| ID | Requirement |
|---|---|
| FR-2.1 | When a Huly issue is created in a mapped project, create a corresponding OneDev issue |
| FR-2.2 | When a Huly issue title or description is edited, update the OneDev issue |
| FR-2.3 | When a Huly issue status changes, transition the OneDev issue to the mapped state |
| FR-2.4 | When a Huly issue assignee changes, update the OneDev issue assignee |
| FR-2.5 | When a comment is added to a Huly issue, post it to the linked OneDev issue |
| FR-2.6 | Comments posted by `pod-onedev` itself MUST NOT trigger an inbound sync loop |

### FR-3 Project mapping and configuration

| ID | Requirement |
|---|---|
| FR-3.1 | A Huly workspace admin MUST be able to connect a OneDev project to a Huly project via the Huly UI (Settings → Integrations) |
| FR-3.2 | Multiple OneDev projects MAY be mapped to the same or different Huly projects |
| FR-3.3 | The admin MUST supply a OneDev personal access token scoped to the target project(s) |
| FR-3.4 | The admin MUST supply the OneDev server base URL |
| FR-3.5 | Issue state mapping MUST be configurable: which OneDev states map to which Huly states |
| FR-3.6 | Disconnecting a project MUST stop sync without deleting already-synced Huly issues |

### FR-4 Identity mapping

| ID | Requirement |
|---|---|
| FR-4.1 | The service MUST maintain a persistent mapping of OneDev issue/PR IDs to Huly document IDs |
| FR-4.2 | On initial connection, the service MUST offer an option to import existing open OneDev issues |
| FR-4.3 | If an inbound event references an unknown OneDev entity, the service MUST create the Huly document and record the mapping |
| FR-4.4 | If a Huly document is deleted, the mapping record MUST be removed; the OneDev issue MUST NOT be deleted |

---

## 3. Non-Functional Requirements

### NFR-1 Service shape (mirrors pod-github)

| ID | Requirement |
|---|---|
| NFR-1.1 | Delivered as a Docker container: `hardcoreeng/onedev:${HULY_VERSION}` |
| NFR-1.2 | Listens on a configurable `PORT` (default `3600` to avoid clashing with github at `3500`) |
| NFR-1.3 | Joins the `huly_net` Docker network |
| NFR-1.4 | Stateless at the container level — all state stored in CockroachDB via transactor |
| NFR-1.5 | Restartable without data loss or duplicate document creation |

### NFR-2 Reliability

| ID | Requirement |
|---|---|
| NFR-2.1 | Webhook delivery failures from OneDev MUST be handled gracefully; the endpoint MUST return HTTP 200 quickly and process async |
| NFR-2.2 | Transient OneDev API failures (network, rate limit) MUST be retried with exponential backoff |
| NFR-2.3 | A failed sync of one document MUST NOT block sync of others |

### NFR-3 Observability

| ID | Requirement |
|---|---|
| NFR-3.1 | Report metrics to `STATS_URL` consistent with other Huly services |
| NFR-3.2 | Structured log output (JSON) with `level`, `service`, `workspaceId`, `event` fields |
| NFR-3.3 | Expose a `/health` endpoint returning HTTP 200 when operational |

---

## 4. Configuration

### Environment variables (container)

| Variable | Required | Description |
|---|---|---|
| `PORT` | Yes | HTTP port the service listens on (default `3600`) |
| `SERVER_SECRET` | Yes | Shared secret for authenticating with Huly's `account` service — must match other services |
| `ACCOUNTS_URL` | Yes | Internal URL of the Huly account service (`http://account:3000`) |
| `STATS_URL` | Yes | Internal URL of the stats service (`http://stats:4900`) |
| `STORAGE_CONFIG` | Yes | MinIO connection string, same format as other services |
| `COLLABORATOR_URL` | Yes | WebSocket URL of the collaborator service |
| `FRONT_URL` | Yes | External base URL of Huly frontend — used to construct links in OneDev comments |
| `ONEDEV_WEBHOOK_SECRET` | Yes | Secret token used to verify inbound OneDev webhooks |

### Environment variables (front service additions)

| Variable | Required | Description |
|---|---|---|
| `ONEDEV_URL` | Yes | External URL of `pod-onedev`, proxied through nginx (`https://host/_onedev`) |

No `ONEDEV_APP` or `ONEDEV_CLIENTID` equivalent — there is no install flow requiring browser-side knowledge of app credentials.

### Nginx addition

```nginx
location /_onedev {
    rewrite ^/_onedev(/.*)$ $1 break;
    proxy_pass http://onedev:3600;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### docker-compose addition

```yaml
onedev:
  image: hardcoreeng/onedev:${HULY_VERSION}
  ports:
    - 3600:3600
  environment:
    - PORT=3600
    - STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin
    - SERVER_SECRET=${SECRET}
    - ACCOUNTS_URL=http://account:3000
    - STATS_URL=http://stats:4900
    - COLLABORATOR_URL=ws${SECURE:+s}://${HOST_ADDRESS}/_collaborator
    - FRONT_URL=http${SECURE:+s}://${HOST_ADDRESS}
    - ONEDEV_WEBHOOK_SECRET=${ONEDEV_WEBHOOK_SECRET}
  restart: unless-stopped
  networks:
    - huly_net

front:
  environment:
    - ONEDEV_URL=http${SECURE:+s}://${HOST_ADDRESS}/_onedev
```

---

## 5. Out of Scope

- User authentication / SSO — handled by Authentik
- Branch creation — handled natively by OneDev CI (`CreateBranchStep` + `IssueInStateTrigger`)
- Code review UI within Huly — PRs surface as read-only references only, same as GitHub integration
- OneDev build/CI status in Huly — not in scope for v1
- Multi-region Huly deployments — follow-on work

---

## 6. Open Questions

| # | Question | Impact |
|---|---|---|
| OQ-1 | Does OneDev's webhook payload include enough user info (email/username) to match Huly accounts, or does the service fall back to a bot identity for all synced actions? | Determines FR-1.9 implementation complexity |
| OQ-2 | Should the mapping store live in CockroachDB via a Huly document type, or in a separate sidecar table? | Affects whether the monorepo model needs a new `@hcengineering/model-onedev` package |
| OQ-3 | What is the desired behaviour when a OneDev issue state has no configured mapping to a Huly state? | Determines FR-1.7 error handling |
| OQ-4 | Should a Huly issue created without a OneDev mapping (i.e. not synced) be pushed to OneDev when the project is connected, or only issues created after connection? | Determines FR-4.2 scope |
