const http = require('http');
const crypto = require('crypto');

function verifySignature(secret, body, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function createServer(config, onIssue) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const signature = req.headers['x-hub-signature-256'];

      if (!verifySignature(config.secret, body, signature)) {
        console.log('[webhook] signature verification failed');
        res.writeHead(401);
        res.end('unauthorized');
        return;
      }

      const event = req.headers['x-github-event'];
      if (event !== 'issues') {
        res.writeHead(200);
        res.end('ignored');
        return;
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }

      const repoFullName = payload.repository?.full_name;
      const repoConfig = config.repos[repoFullName];

      if (!repoConfig) {
        console.log(`[webhook] repo ${repoFullName} not configured, ignoring`);
        res.writeHead(200);
        res.end('ignored');
        return;
      }

      const triggerLabel = repoConfig.triggerLabel || 'claude';

      if (payload.action === 'labeled' && payload.label?.name === triggerLabel) {
        const issue = payload.issue;
        console.log(`[webhook] received issue #${issue.number}: ${issue.title} (${repoFullName})`);
        onIssue({ repoFullName, repoConfig, issue });
      }

      res.writeHead(200);
      res.end('ok');
    });
  });

  return server;
}

module.exports = { createServer };
