const { execSync } = require('child_process');
const config = require('./config');
const { createServer } = require('./server');
const { startTunnel, updateWebhooks } = require('./tunnel');
const sessions = require('./sessions');

function checkDeps() {
  const deps = ['claude', 'gh', 'cloudflared', 'git'];
  const missing = deps.filter((d) => {
    try { execSync(`which ${d}`, { stdio: 'pipe' }); return false; } catch { return true; }
  });
  if (missing.length) {
    console.error(`Missing dependencies: ${missing.join(', ')}`);
    console.error('Please install them before using issue-bot.');
    process.exit(1);
  }
}

function cmdInit(args) {
  const repo = config.detectRepo();
  if (!repo) {
    console.error('Not a GitHub repository. Run this in a git directory with a GitHub remote.');
    process.exit(1);
  }

  const localPath = process.cwd();
  const baseBranch = getFlag(args, '--base') || config.detectBaseBranch();
  const triggerLabel = getFlag(args, '--label') || 'claude';

  const cfg = config.ensureConfig();
  cfg.repos[repo] = { localPath, baseBranch, triggerLabel };
  config.save(cfg);

  console.log(`✓ Registered ${repo}`);
  console.log(`  Path:   ${localPath}`);
  console.log(`  Branch: ${baseBranch}`);
  console.log(`  Label:  ${triggerLabel}`);
}

function cmdList() {
  const cfg = config.load();
  const repos = Object.entries(cfg.repos || {});
  if (repos.length === 0) {
    console.log('No repos registered. Run `issue-bot init` in a project directory.');
    return;
  }
  console.log('Registered repos:\n');
  for (const [repo, info] of repos) {
    const hookId = cfg.hooks?.[repo];
    console.log(`  ${repo}`);
    console.log(`    Path:    ${info.localPath}`);
    console.log(`    Branch:  ${info.baseBranch}`);
    console.log(`    Label:   ${info.triggerLabel}`);
    console.log(`    Webhook: ${hookId || 'not created yet'}`);
    console.log();
  }
}

function cmdRemove() {
  const repo = config.detectRepo();
  if (!repo) {
    console.error('Not a GitHub repository.');
    process.exit(1);
  }

  const cfg = config.load();
  if (!cfg.repos[repo]) {
    console.error(`${repo} is not registered.`);
    process.exit(1);
  }

  const hookId = cfg.hooks[repo];
  if (hookId) {
    try {
      execSync(`gh api repos/${repo}/hooks/${hookId} -X DELETE`, { stdio: 'pipe' });
      console.log(`Deleted webhook (id: ${hookId})`);
    } catch {
      console.log('Could not delete webhook on GitHub (may already be gone)');
    }
  }

  delete cfg.repos[repo];
  delete cfg.hooks[repo];
  config.save(cfg);
  console.log(`✓ Removed ${repo}`);
}

function cmdStart(args) {
  checkDeps();

  const cfg = config.ensureConfig();
  const repos = Object.keys(cfg.repos);

  if (repos.length === 0) {
    console.error('No repos registered. Run `issue-bot init` in a project directory first.');
    process.exit(1);
  }

  const port = parseInt(getFlag(args, '--port') || cfg.port || '7890', 10);

  // Initialize session manager
  sessions.init();

  // Job queue for sequential processing
  const queue = [];
  let processing = false;

  async function processNext() {
    if (processing || queue.length === 0) return;
    processing = true;
    const job = queue.shift();
    try {
      await job();
    } catch (err) {
      console.error('[queue] job error:', err.message);
    }
    processing = false;
    processNext();
  }

  function enqueue(fn) {
    queue.push(fn);
    processNext();
  }

  // Start webhook server
  const server = createServer(cfg, {
    onLabel: ({ repoFullName, repoConfig, issue }) => {
      enqueue(() => sessions.createSession(repoFullName, repoConfig, issue));
    },
    onComment: ({ repoFullName, repoConfig, issue, comment }) => {
      enqueue(() => sessions.handleComment(repoFullName, repoConfig, issue, comment));
    },
    onClose: ({ repoFullName, issueNumber }) => {
      sessions.closeSession(repoFullName, issueNumber);
    },
  });

  server.listen(port, () => {
    console.log(`[server] listening on :${port}`);
    console.log(`[server] watching ${repos.length} repo(s): ${repos.join(', ')}`);
  });

  // Start tunnel + auto-register webhooks
  startTunnel(port, (tunnelUrl) => {
    updateWebhooks(tunnelUrl, cfg);
  });

  // Graceful shutdown
  const cleanup = () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

function run(args) {
  const cmd = args[0];
  switch (cmd) {
    case 'init':
      return cmdInit(args.slice(1));
    case 'start':
      return cmdStart(args.slice(1));
    case 'list':
      return cmdList();
    case 'remove':
      return cmdRemove();
    default:
      console.log(`claude-issue-bot — GitHub Issues as Claude Code chat.

Usage:
  issue-bot init [--label <name>] [--base <branch>]   Register current repo
  issue-bot start [--port <port>]                      Start the bot
  issue-bot list                                       List registered repos
  issue-bot remove                                     Unregister current repo

Workflow:
  1. cd your-project && issue-bot init
  2. issue-bot start
  3. Add "claude" label to any issue → starts a Claude session
  4. Comment on the issue → Claude reads and replies
  5. Claude commits, pushes, and creates PRs autonomously
`);
  }
}

module.exports = { run };
