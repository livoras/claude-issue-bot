const { spawn, execSync } = require('child_process');
const config = require('./config');

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function startTunnel(port, onUrl) {
  console.log('[tunnel] starting cloudflared...');
  const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let found = false;

  const handleLine = (line) => {
    const str = line.toString();
    const match = str.match(TUNNEL_URL_RE);
    if (match && !found) {
      found = true;
      console.log(`[tunnel] URL: ${match[0]}`);
      onUrl(match[0]);
    }
  };

  proc.stdout.on('data', handleLine);
  proc.stderr.on('data', handleLine);

  proc.on('exit', (code) => {
    console.log(`[tunnel] cloudflared exited (code ${code}), restarting in 5s...`);
    setTimeout(() => startTunnel(port, onUrl), 5000);
  });

  return proc;
}

function updateWebhooks(tunnelUrl, cfg) {
  const webhookUrl = `${tunnelUrl}/webhook`;
  console.log(`[hooks] updating webhooks to ${webhookUrl}`);

  for (const repo of Object.keys(cfg.repos)) {
    const hookId = cfg.hooks[repo];
    try {
      if (hookId) {
        // Update existing webhook
        execSync(
          `gh api repos/${repo}/hooks/${hookId} -X PATCH ` +
            `-f 'config[url]=${webhookUrl}' ` +
            `-f 'config[content_type]=json' ` +
            `-f 'config[secret]=${cfg.secret}'`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        console.log(`[hooks] updated webhook for ${repo} (id: ${hookId})`);
      } else {
        // Create new webhook
        const result = execSync(
          `gh api repos/${repo}/hooks -X POST ` +
            `-f 'name=web' ` +
            `-f 'config[url]=${webhookUrl}' ` +
            `-f 'config[content_type]=json' ` +
            `-f 'config[secret]=${cfg.secret}' ` +
            `-f 'events[]=issues' ` +
            `-F 'active=true'`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const data = JSON.parse(result);
        cfg.hooks[repo] = data.id;
        config.save(cfg);
        console.log(`[hooks] created webhook for ${repo} (id: ${data.id})`);
      }
    } catch (err) {
      console.error(`[hooks] failed for ${repo}: ${err.stderr || err.message}`);
    }
  }
}

module.exports = { startTunnel, updateWebhooks };
