const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');

const CLAUDE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');

let sessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    }
  } catch {}
}

function saveSessions() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2) + '\n');
}

function sessionKey(repoFullName, issueNumber) {
  return `${repoFullName}#${issueNumber}`;
}

function runClaude(prompt, { sessionId, cwd, worktree }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--session-id', sessionId, '--dangerously-skip-permissions'];
    if (worktree) args.push('--worktree', worktree);

    console.log(`[claude] running with session ${sessionId.slice(0, 8)}...`);

    const proc = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT / 1000}s`));
    }, CLAUDE_TIMEOUT);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      console.log(`[claude] session ${sessionId.slice(0, 8)} exited with code ${code}`);
      if (code === 0) resolve();
      else reject(new Error(`claude exited with code ${code}\n${stderr}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[claude] spawn error:`, err.message);
      reject(err);
    });
  });
}

async function createSession(repoFullName, repoConfig, issue) {
  const key = sessionKey(repoFullName, issue.number);

  if (sessions[key]) {
    console.log(`[sessions] session already exists for ${key}, skipping`);
    return;
  }

  const sessionId = crypto.randomUUID();
  console.log(`[sessions] creating session for ${key} (${sessionId.slice(0, 8)})`);

  sessions[key] = {
    sessionId,
    repoFullName,
    issueNumber: issue.number,
    localPath: repoConfig.localPath,
  };
  saveSessions();

  const prompt = [
    `You are working on GitHub Issue #${issue.number} in repo ${repoFullName}.`,
    ``,
    `## ${issue.title}`,
    ``,
    issue.body || '(no description)',
    ``,
    `You have full autonomy:`,
    `- Implement the requested changes`,
    `- Commit and push when ready`,
    `- Create a PR with \`gh pr create\``,
    `- Reply on the issue with \`gh issue comment ${issue.number} --repo ${repoFullName} --body "<!-- bot -->\nyour message"\``,
    `  IMPORTANT: Always start the body with \`<!-- bot -->\` so the system can identify your replies.`,
    ``,
    `Always reply on the issue to report your progress. Keep replies concise.`,
  ].join('\n');

  try {
    await runClaude(prompt, {
      sessionId,
      cwd: repoConfig.localPath,
      worktree: `issue-${issue.number}`,
    });
    console.log(`[sessions] session ${key} ready for follow-up comments`);
  } catch (err) {
    console.error(`[sessions] error for ${key}:`, err.message);
  }
}

async function handleComment(repoFullName, repoConfig, issue, comment) {
  const key = sessionKey(repoFullName, issue.number);
  const session = sessions[key];

  if (!session) {
    console.log(`[sessions] no active session for ${key}, ignoring comment`);
    return;
  }

  console.log(`[sessions] forwarding comment to ${key}: ${comment.body.slice(0, 80)}...`);

  try {
    await runClaude(comment.body, {
      sessionId: session.sessionId,
      cwd: session.localPath,
    });
    console.log(`[sessions] claude done for ${key}`);
  } catch (err) {
    console.error(`[sessions] error for ${key}:`, err.message);
  }
}

function closeSession(repoFullName, issueNumber) {
  const key = sessionKey(repoFullName, issueNumber);
  if (sessions[key]) {
    console.log(`[sessions] closing session for ${key}`);
    delete sessions[key];
    saveSessions();
  }
}

function init() {
  loadSessions();
  console.log(`[sessions] loaded ${Object.keys(sessions).length} active session(s)`);
}

module.exports = { init, createSession, handleComment, closeSession };
