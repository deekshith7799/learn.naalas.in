import pg from 'pg';
import Cursor from 'pg-cursor';
import { buildDataset, chunk } from './seed.js';
import { splitSql } from './sqlsplit.js';
import { labCfg, labName, labPassword, MAX_ROWS, MAX_STATEMENTS, ser } from './common.js';

const ENGINE = 'postgresql';
const WATCHDOG_MS = 15000;

// Return date/time columns as plain text instead of JS Dates (no timezone surprises).
const types = {
  getTypeParser: (oid, format) => ([1082, 1114, 1184].includes(oid) ? v => v : pg.types.getTypeParser(oid, format)),
};

const DDL = `
CREATE TABLE customers (id int PRIMARY KEY, name text, email text, city text, signup_date date);
CREATE TABLE products (id int PRIMARY KEY, name text, category text, price numeric(10,2));
CREATE TABLE orders (id int PRIMARY KEY, customer_id int, status text, total numeric(12,2), created_at timestamp);
CREATE TABLE order_items (id int PRIMARY KEY, order_id int, product_id int, qty int, unit_price numeric(10,2));
`;
const INSERTS = {
  customers: 'INSERT INTO customers SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, name text, email text, city text, signup_date date)',
  products: 'INSERT INTO products SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, name text, category text, price numeric(10,2))',
  orders: 'INSERT INTO orders SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, customer_id int, status text, total numeric(12,2), created_at timestamp)',
  order_items: 'INSERT INTO order_items SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, order_id int, product_id int, qty int, unit_price numeric(10,2))',
};

export function classify(e) {
  const code = e?.code;
  if (['28P01', '28000', '3D000'].includes(code)) return 'auth';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '57P03', '57P01'].includes(code)) return 'down';
  if (/Connection terminated|timeout expired|connect ECONN/i.test(e?.message || '')) return 'down';
  return null;
}

const adminClient = () =>
  new pg.Client({ host: labCfg.pg.host, port: labCfg.pg.port, user: labCfg.pg.adminUser, password: labCfg.adminPassword, database: 'postgres', connectionTimeoutMillis: 5000 });

const userClient = userId =>
  new pg.Client({
    host: labCfg.pg.host, port: labCfg.pg.port, user: labName(userId), password: labPassword(ENGINE, userId),
    database: labName(userId), connectionTimeoutMillis: 5000, types,
  });

export async function provision(userId, { reset = false } = {}) {
  const role = labName(userId);
  const pw = labPassword(ENGINE, userId); // hex only, safe to inline
  const admin = adminClient();
  await admin.connect();
  try {
    const hasRole = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount > 0;
    await admin.query(hasRole ? `ALTER ROLE ${role} LOGIN PASSWORD '${pw}'` : `CREATE ROLE ${role} LOGIN PASSWORD '${pw}' CONNECTION LIMIT 5`);
    for (const s of ["statement_timeout TO '5s'", "lock_timeout TO '3s'", "idle_in_transaction_session_timeout TO '15s'", "temp_file_limit TO '100MB'"]) {
      await admin.query(`ALTER ROLE ${role} SET ${s}`);
    }
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [role])).rowCount > 0;
    if (exists && !reset) return;
    if (exists) await admin.query(`DROP DATABASE ${role} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${role} OWNER ${role}`);
    await admin.query(`REVOKE ALL ON DATABASE ${role} FROM PUBLIC`);
    try {
      await seed(userId);
    } catch (e) {
      await admin.query(`DROP DATABASE IF EXISTS ${role} WITH (FORCE)`).catch(() => {});
      throw e;
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

async function seed(userId) {
  const ds = buildDataset();
  const c = userClient(userId);
  await c.connect();
  try {
    await c.query('SET statement_timeout = 0');
    await c.query(DDL);
    for (const [table, key] of [['customers', 'customers'], ['products', 'products'], ['orders', 'orders'], ['order_items', 'items']]) {
      for (const part of chunk(ds[key], 2500)) await c.query(INSERTS[table], [JSON.stringify(part)]);
    }
    await c.query('ANALYZE');
  } finally {
    await c.end().catch(() => {});
  }
}

// psql-style helpers
function metaToSql(input) {
  const [cmd, arg] = input.trim().split(/\s+/);
  const safe = n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n || '');
  if (cmd === '\\dt' || (cmd === '\\d' && !arg)) {
    return [`SELECT tablename AS "table", tableowner AS owner FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`];
  }
  if (cmd === '\\d' && arg) {
    if (!safe(arg)) throw new Error('Table name must be letters, digits and underscores');
    return [
      `SELECT column_name AS "column", data_type AS type, is_nullable AS nullable, column_default AS "default" FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${arg}' ORDER BY ordinal_position`,
      `SELECT indexname AS "index", indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${arg}'`,
    ];
  }
  if (cmd === '\\di') {
    return [`SELECT indexname AS "index", tablename AS "table", indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' ORDER BY 2, 1`];
  }
  throw new Error(`Unsupported meta-command ${cmd}. Available: \\dt  \\d [table]  \\di`);
}

const READ = /^(select|with|values|table|show|explain)\b/i;
const stripLead = s => s.replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)+/, '');

const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

async function runOne(client, sql) {
  if (READ.test(stripLead(sql))) {
    const cursor = client.query(new Cursor(sql, [], { rowMode: 'array', types }));
    const { rows, result } = await new Promise((resolve, reject) =>
      cursor.read(MAX_ROWS + 1, (err, rows, result) => (err ? reject(err) : resolve({ rows, result })))
    );
    await withTimeout(new Promise(res => cursor.close(() => res())), 2000);
    const fields = result.fields || [];
    if (!fields.length) return { kind: 'message', text: tag(result) };
    const truncated = rows.length > MAX_ROWS;
    return { kind: 'table', columns: fields.map(f => f.name), rows: rows.slice(0, MAX_ROWS).map(r => r.map(ser)), rowCount: truncated ? null : rows.length, truncated };
  }
  const res = await client.query({ text: sql, rowMode: 'array', types });
  if (res.fields && res.fields.length) {
    const truncated = res.rows.length > MAX_ROWS;
    return { kind: 'table', columns: res.fields.map(f => f.name), rows: res.rows.slice(0, MAX_ROWS).map(r => r.map(ser)), rowCount: truncated ? null : res.rows.length, truncated };
  }
  return { kind: 'message', text: tag(res) };
}

const tag = r => (r.command ? `${r.command}${r.rowCount != null ? ' ' + r.rowCount : ''}` : 'OK');

const fmtErr = e => {
  let m = `ERROR: ${e.message}`;
  if (e.detail) m += `\nDETAIL: ${e.detail}`;
  if (e.hint) m += `\nHINT: ${e.hint}`;
  return m;
};

export async function run(userId, input) {
  let statements;
  try {
    statements = input.trim().startsWith('\\') ? metaToSql(input) : splitSql(input, { dollar: true });
  } catch (e) {
    return [{ kind: 'error', message: e.message }];
  }
  if (!statements.length) return [{ kind: 'message', text: 'Nothing to run.' }];
  if (statements.length > MAX_STATEMENTS) return [{ kind: 'error', message: `Too many statements (max ${MAX_STATEMENTS} per run).` }];

  const client = userClient(userId);
  client.on('error', () => {});
  await client.connect();

  // Users can override statement_timeout inside their session, so enforce a hard
  // wall-clock limit from outside: terminate the backend from an admin connection.
  let timedOut = false;
  const watchdog = setTimeout(async () => {
    timedOut = true;
    const a = adminClient();
    try {
      await a.connect();
      await a.query('SELECT pg_terminate_backend($1)', [client.processID]);
    } catch { /* connection already gone */ } finally {
      await a.end().catch(() => {});
    }
  }, WATCHDOG_MS);

  const results = [];
  try {
    for (const sql of statements) {
      try {
        results.push(await runOne(client, sql));
      } catch (e) {
        if (timedOut) {
          results.push({ kind: 'error', message: `ERROR: run stopped after ${WATCHDOG_MS / 1000} seconds (lab limit)` });
          break;
        }
        if (classify(e)) throw e;
        results.push({ kind: 'error', message: fmtErr(e) });
        break;
      }
    }
  } finally {
    clearTimeout(watchdog);
    await client.end().catch(() => {});
  }
  return results;
}

// Size of one learner's database in bytes (used for the sandbox size cap).
export async function size(userId) {
  const admin = adminClient();
  await admin.connect();
  try {
    const r = await admin.query('SELECT pg_database_size($1) AS b', [labName(userId)]);
    return Number(r.rows[0].b);
  } finally {
    await admin.end().catch(() => {});
  }
}

// Remove a learner's database and role (when the user is deleted).
export async function drop(userId) {
  const role = labName(userId);
  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${role} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
  } finally {
    await admin.end().catch(() => {});
  }
}
