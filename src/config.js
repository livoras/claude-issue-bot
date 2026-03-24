const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CONFIG_DIR = path.join(process.env.HOME, '.issue-bot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const WORKTREE_BASE = path.join(CONFIG_DIR, 'worktrees');

const DEFAULT_CONFIG = {
  secret: crypto.randomBytes(16).toString('hex'),
  port: 7890,
  repos: {},
  hooks: {},
};

function load() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG, secret: crypto.randomBytes(16).toString('hex') };
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function save(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_FILE)) save(DEFAULT_CONFIG);
  return load();
}

/** Detect GitHub owner/repo from current git directory */
function detectRepo(dir = process.cwd()) {
  try {
    const remote = execSync('git remote get-url origin', { cwd: dir, encoding: 'utf-8' }).trim();
    // ssh: git@github.com:owner/repo.git
    // https: https://github.com/owner/repo.git
    const match = remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {}
  return null;
}

/** Detect default branch */
function detectBaseBranch(dir = process.cwd()) {
  try {
    const head = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    return head.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

module.exports = { CONFIG_DIR, CONFIG_FILE, WORKTREE_BASE, load, save, ensureConfig, detectRepo, detectBaseBranch };
