# claude-issue-bot

Let GitHub Issues talk to your local Claude Code. Label an issue, get a PR.

## How it works

```
GitHub Issue (add "claude" label)
  → Webhook via Cloudflare Tunnel
  → Your local machine
  → git worktree + claude -p
  → Auto PR + comment on issue
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Code](https://claude.ai/claude-code) CLI
- [GitHub CLI](https://cli.github.com/) (`gh`, authenticated)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`)

## Install

```bash
npm install -g claude-issue-bot
```

## Quick Start

```bash
# 1. Register a repo
cd your-project
issue-bot init

# 2. Start the bot
issue-bot start

# 3. Go to GitHub, create an issue, add the "claude" label
#    → Bot picks it up, implements it, opens a PR
```

## Commands

### `issue-bot init`

Register the current git repo. Run this inside any GitHub-backed project.

```bash
issue-bot init                    # defaults: label=claude, branch=main
issue-bot init --label ai         # custom trigger label
issue-bot init --base develop     # custom base branch
```

### `issue-bot start`

Start the bot. Launches Cloudflare Tunnel + webhook server. One process handles all registered repos.

```bash
issue-bot start                   # default port 7890
issue-bot start --port 8080       # custom port
```

### `issue-bot list`

List all registered repos.

### `issue-bot remove`

Unregister the current repo and delete its GitHub webhook.

## How it works internally

1. `issue-bot start` spawns a `cloudflared` quick tunnel (free, no account needed)
2. Automatically creates/updates GitHub webhooks for all registered repos
3. When an issue gets the trigger label:
   - Creates a `git worktree` (isolated branch)
   - Runs `claude -p` with the issue content
   - Commits changes and pushes
   - Creates a PR via `gh pr create`
   - Comments on the issue with the PR link
   - Cleans up the worktree
4. If `cloudflared` restarts (URL changes), webhooks are auto-updated

## Config

Stored at `~/.issue-bot/config.json`. Managed via CLI commands, no manual editing needed.

## License

MIT
