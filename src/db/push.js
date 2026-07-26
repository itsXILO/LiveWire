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
const { sql } = await import('drizzle-orm');

const sqlConn = neon(process.env.DATABASE_URL);
const db = drizzle(sqlConn);

async function pushSchema() {
  try {
    console.log('Dropping old tables if they exist...');
    await db.execute(sql`DROP TABLE IF EXISTS commentary CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS matches CASCADE`);
    await db.execute(sql`DROP TYPE IF EXISTS match_status CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS demo_users CASCADE`);

    console.log('Creating enum match_status...');
    await db.execute(sql`CREATE TYPE match_status AS ENUM('scheduled', 'live', 'finished')`);

    console.log('Creating matches table...');
    await db.execute(sql`
      CREATE TABLE matches (
        id serial PRIMARY KEY,
        sport text NOT NULL,
        home_team text NOT NULL,
        away_team text NOT NULL,
        status match_status NOT NULL DEFAULT 'scheduled',
        start_time timestamp,
        end_time timestamp,
        home_score integer NOT NULL DEFAULT 0,
        away_score integer NOT NULL DEFAULT 0,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    console.log('Creating commentary table...');
    await db.execute(sql`
      CREATE TABLE commentary (
        id serial PRIMARY KEY,
        match_id integer NOT NULL REFERENCES matches(id),
        minute integer,
        sequence integer NOT NULL,
        period text,
        event_type text,
        actor text,
        team text,
        message text NOT NULL,
        metadata jsonb,
        tags text[],
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    console.log('Verifying tables...');
    const tables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    console.log('Tables in database:', tables.rows.map(r => r.table_name));

    console.log('\nSchema pushed successfully!');
  } catch (e) {
    console.error('Error pushing schema:', e.message || e);
    process.exit(1);
  }
}

pushSchema();
