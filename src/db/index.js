import 'dotenv/config';
import dns from 'dns';
import https from 'https';

const NEON_HOST = 'ep-fancy-queen-ax3mhgfh.c-4.us-east-2.aws.neon.tech';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env');
}

const ip = await new Promise((resolve, reject) => {
  dns.resolve4(NEON_HOST, (err, addrs) => {
    if (err) reject(err);
    else resolve(addrs[0]);
  });
});

globalThis.fetch = function (url, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: ip,
      port: 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      servername: NEON_HOST,
      timeout: 15000,
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: { get: (n) => res.headers[n], entries: () => Object.entries(res.headers) },
          json: () => Promise.resolve(JSON.parse(body)),
          text: () => Promise.resolve(body),
          clone() { return this; },
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
};

const { neon } = await import('@neondatabase/serverless');
const { drizzle } = await import('drizzle-orm/neon-http');
const schema = await import('./schema.js');

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
