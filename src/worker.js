const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { WORKTREE_BASE } = require('./config');

const CLAUDE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function runClaude(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT / 1000}s`));
    }, CLAUDE_TIMEOUT);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited with code ${code}\n${stderr}`));
    });
  });
}

class Worker {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  enqueue(job) {
    this.queue.push(job);
    this._processNext();
  }

  async _processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const job = this.queue.shift();
    try {
      await processIssue(job);
    } catch (err) {
      console.error(`[worker] error processing issue #${job.issue.number}:`, err.message);
    }
    this.processing = false;
    this._processNext();
  }
}

async function processIssue({ repoFullName, repoConfig, issue }) {
  const { number, title, body } = issue;
  const repoName = repoFullName.split('/')[1];
  const branch = `issue-${number}-${slugify(title)}`;
  const worktreeDir = path.join(WORKTREE_BASE, repoName, branch);
  const localPath = repoConfig.localPath;
  const baseBranch = repoConfig.baseBranch || 'main';

  console.log(`[worker] processing #${number}: ${title} (${repoFullName})`);

  // Comment that we're working on it
  try {
    exec(`gh issue comment ${number} --repo ${repoFullName} --body "🤖 Working on it..."`);
  } catch {}

  try {
    // Fetch latest
    exec(`git fetch origin ${baseBranch}`, { cwd: localPath });

    // Create worktree
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    exec(`git worktree add "${worktreeDir}" -b ${branch} origin/${baseBranch}`, { cwd: localPath });

    // Build prompt
    const prompt = [
      `Please implement the following GitHub Issue.`,
      ``,
      `## Issue #${number}: ${title}`,
      ``,
      body || '(no description)',
      ``,
      `When done, make sure all changes are saved. Do NOT commit — the caller will handle that.`,
    ].join('\n');

    // Run Claude
    console.log(`[worker] running claude in ${worktreeDir}...`);
    await runClaude(prompt, worktreeDir);

    // Check for changes
    const status = exec('git status --porcelain', { cwd: worktreeDir });
    if (!status) {
      console.log(`[worker] no changes for #${number}`);
      exec(`gh issue comment ${number} --repo ${repoFullName} --body "🤖 Analyzed the issue but no code changes were needed."`);
      return;
    }

    // Commit and push
    exec('git add -A', { cwd: worktreeDir });
    exec(`git commit -m "feat: implement #${number} - ${title}"`, { cwd: worktreeDir });
    exec(`git push origin ${branch}`, { cwd: worktreeDir });

    // Create PR
    const prUrl = exec(
      `gh pr create --repo ${repoFullName} --title "#${number}: ${title}" ` +
        `--body "Closes #${number}\n\nAutomatically implemented by [claude-issue-bot](https://github.com/livoras/claude-issue-bot)." ` +
        `--head ${branch} --base ${baseBranch}`,
      { cwd: worktreeDir }
    );

    console.log(`[worker] PR created: ${prUrl}`);

    // Comment on issue
    exec(`gh issue comment ${number} --repo ${repoFullName} --body "🤖 PR created: ${prUrl}"`);
  } catch (err) {
    console.error(`[worker] failed #${number}:`, err.message);
    try {
      const msg = `🤖 Failed to process this issue:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``;
      exec(`gh issue comment ${number} --repo ${repoFullName} --body "${msg.replace(/"/g, '\\"')}"`);
    } catch {}
  } finally {
    // Cleanup worktree
    try {
      exec(`git worktree remove "${worktreeDir}" --force`, { cwd: localPath });
      console.log(`[worker] worktree cleaned up for #${number}`);
    } catch {}
  }
}

module.exports = { Worker };
