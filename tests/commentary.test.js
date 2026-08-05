import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { db } from '../src/db/index.js';
import { commentary, matches } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const TEST_PORT = 8910;
const TEST_HOST = '127.0.0.1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function request(method, route, body) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA };
  if (data) headers['Content-Length'] = Buffer.byteLength(data);

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: TEST_HOST, port: TEST_PORT, path: route, method, headers },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          let body = chunks || '{}';
          try {
            body = JSON.parse(body);
          } catch {}
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await request('GET', '/');
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start in time.');
}

function connectWebSocket() {
  const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`, {
    headers: { 'User-Agent': BROWSER_UA },
  });
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, inbox }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`WS upgrade failed: ${res.statusCode}`)),
    );
  });
}

test('creating commentary broadcasts the commentary WebSocket event to subscribers', async (t) => {
  const server = spawn('node', ['src/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT), HOST: TEST_HOST },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverError = '';
  server.stderr.on('data', (d) => (serverError += d));

  t.after(async () => {
    server.kill();
    if (createdMatchId) {
      await db.delete(commentary).where(eq(commentary.matchId, createdMatchId));
      await db.delete(matches).where(eq(matches.id, createdMatchId));
    }
  });

  let createdMatchId;
  await waitForServer();

  const { ws, inbox } = await connectWebSocket();
  t.after(() => ws.close());

  const matchRes = await request('POST', '/matches', {
    sport: 'football',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    startTime: '2026-08-06T00:00:00Z',
    endTime: '2026-08-06T02:00:00Z',
  });
  assert.equal(matchRes.status, 201, serverError);
  createdMatchId = matchRes.body.data.id;

  ws.send(JSON.stringify({ type: 'subscribe', matchId: createdMatchId }));
  await new Promise((r) => setTimeout(r, 200));

  const comment = {
    minutes: 5,
    sequence: '1',
    period: '1H',
    eventType: 'goal',
    actor: 'player-1',
    team: 'Home FC',
    message: 'Goal for the home team!',
    metadata: { assist: 'player-2' },
    tags: ['goal'],
  };
  const commentRes = await request(
    'POST',
    `/matches/${createdMatchId}/commentary/${createdMatchId}`,
    comment,
  );
  assert.equal(commentRes.status, 201, serverError);

  const event = await new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const found = inbox.find((m) => m.type === 'commentary');
      if (found) {
        clearInterval(poll);
        resolve(found);
      } else if (Date.now() - started > 3000) {
        clearInterval(poll);
        resolve(undefined);
      }
    }, 50);
  });

  assert.ok(event, `No commentary event received. inbox=${JSON.stringify(inbox)}`);
  assert.equal(event.type, 'commentary');
  assert.equal(event.data.matchId, createdMatchId);
  assert.equal(event.data.message, comment.message);
});
