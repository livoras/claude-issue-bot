const http = require('http');
const crypto = require('crypto');

function verifySignature(secret, body, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function createServer(config, { onLabel, onComment, onClose }) {
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

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }

      const event = req.headers['x-github-event'];
      const repoFullName = payload.repository?.full_name;
      const repoConfig = config.repos[repoFullName];

      if (!repoConfig) {
        res.writeHead(200);
        res.end('ignored');
        return;
      }

      const triggerLabel = repoConfig.triggerLabel || 'claude';

      // Issue labeled → create session
      if (event === 'issues' && payload.action === 'labeled' && payload.label?.name === triggerLabel) {
        console.log(`[webhook] issue #${payload.issue.number} labeled "${triggerLabel}" (${repoFullName})`);
        onLabel({ repoFullName, repoConfig, issue: payload.issue });
      }

      // Issue comment → forward to session
      if (event === 'issue_comment' && payload.action === 'created') {
        // Only handle issues with the trigger label
        const hasLabel = payload.issue.labels?.some((l) => l.name === triggerLabel);
        if (hasLabel) {
          onComment({ repoFullName, repoConfig, issue: payload.issue, comment: payload.comment });
        }
      }

      // Issue closed → end session
      if (event === 'issues' && payload.action === 'closed') {
        onClose({ repoFullName, issueNumber: payload.issue.number });
      }

      res.writeHead(200);
      res.end('ok');
    });
  });

  return server;
}

module.exports = { createServer };
