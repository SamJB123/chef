# Running Convex Chef Locally

## Prerequisites

- Node.js and pnpm installed
- Claude Code CLI authenticated (`claude --version` to check)
- CLIProxyAPI installed at `C:\Users\sambi\tools\cli-proxy-api\`

## 1. Start CLIProxyAPI

```bash
cd C:\Users\sambi\tools\cli-proxy-api
./cli-proxy-api.exe
```

This starts the proxy on `http://127.0.0.1:8317`. It exposes your Claude Max and OpenAI Codex subscriptions as an OpenAI-compatible API.

**Management UI:** http://127.0.0.1:8317/management.html

### If credentials have expired

Re-authenticate as needed:

```bash
./cli-proxy-api.exe -claude-login
./cli-proxy-api.exe -codex-login
```

## 2. Start Chef

```bash
cd C:\Users\sambi\Github\convex-chef
pnpm dev
```

## 3. Use local proxy models

In the model selector, choose:
- **Claude Opus 4.6 (Local Proxy)** — routes through your Claude Max subscription
- **GPT-5.4 (Local Proxy)** — routes through your Codex subscription

These options only appear in dev mode. They don't require API keys — the proxy handles auth.

## Configuration

The proxy URL defaults to `http://localhost:8317/v1`. Override it by setting `CLAUDE_PROXY_URL` in your environment.
