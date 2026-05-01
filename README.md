# pod-onedev

Bridge service between [OneDev](https://onedev.io) and [Huly](https://huly.io).

Standalone service, intended for upstream contribution to
[hcengineering/platform](https://github.com/hcengineering/platform).

## Status

🚧 Early scaffold — webhook handler stubs in place, Huly client pending implementation.

## Setup

```bash
cp .env.example .env
# fill in .env values

npm install
npm run dev
```

## Docker

```bash
docker compose -f docker-compose.dev.yml up
```

## Requirements

See [docs/pod-onedev-requirements.md](docs/pod-onedev-requirements.md).

## Architecture

See [AGENTS.md](AGENTS.md) for full architectural context.
