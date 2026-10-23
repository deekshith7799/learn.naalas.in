import mysql from 'mysql2/promise';
import { buildDataset, chunk } from './seed.js';
import { splitSql } from './sqlsplit.js';
import { labCfg, labName, labPassword, MAX_ROWS, MAX_STATEMENTS, ser } from './common.js';

const ENGINE = 'mysql';

const DDL = [
  'CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(150), city VARCHAR(50), signup_date DATE)',
  'CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(100), category VARCHAR(50), price DECIMAL(10,2))',
  'CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT, status VARCHAR(20), total DECIMAL(12,2), created_at DATETIME)',
  'CREATE TABLE order_items (id INT PRIMARY KEY, order_id INT, product_id INT, qty INT, unit_price DECIMAL(10,2))',
];
const INSERTS = {
  customers: ['INSERT INTO customers (id, name, email, city, signup_date) VALUES ?', r => [r.id, r.name, r.email, r.city, r.signup_date]],
  products: ['INSERT INTO products (id, name, category, price) VALUES ?', r => [r.id, r.name, r.category, r.price]],
  orders: ['INSERT INTO orders (id, customer_id, status, total, created_at) VALUES ?', r => [r.id, r.customer_id, r.status, r.total, r.created_at]],
  order_items: ['INSERT INTO order_items (id, order_id, product_id, qty, unit_price) VALUES ?', r => [r.id, r.order_id, r.product_id, r.qty, r.unit_price]],
};

// Everything a learner needs inside their own database, but not EVENT (background jobs that outlive a run).
const PRIVS = 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER, CREATE TEMPORARY TABLES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE, LOCK TABLES';

export function classify(e) {
  const code = e?.code;
  if (['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(code)) return 'auth';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET'].includes(code)) return 'down';
  return null;
}

const base = { host: labCfg.mysql.host, port: labCfg.mysql.port, connectTimeout: 5000, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true };
const adminConn = () => mysql.createConnection({ ...base, user: labCfg.mysql.adminUser, password: labCfg.adminPassword });
const userConn = userId => mysql.createConnection({ ...base, user: labName(userId), password: labPassword(ENGINE, userId), database: labName(userId) });

export async function provision(userId, { reset = false } = {}) {
  const u = labName(userId);
  const pw = labPassword(ENGINE, userId); // hex only
  const admin = await adminConn();
  try {
    await admin.query(`CREATE USER IF NOT EXISTS '${u}'@'%' IDENTIFIED BY '${pw}' WITH MAX_USER_CONNECTIONS 5`);
    await admin.query(`ALTER USER '${u}'@'%' IDENTIFIED BY '${pw}'`);
    const [found] = await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = ?', [u]);
    const exists = found.length > 0;
    if (exists && !reset) {
      await admin.query(`GRANT ${PRIVS} ON \`${u}\`.* TO '${u}'@'%'`);
      return;
    }
    if (exists) await admin.query(`DROP DATABASE \`${u}\``);
    await admin.query(`CREATE DATABASE \`${u}\``);
    await admin.query(`GRANT ${PRIVS} ON \`${u}\`.* TO '${u}'@'%'`);
    try {
      await seed(userId);
    } catch (e) {
      await admin.query(`DROP DATABASE IF EXISTS \`${u}\``).catch(() => {});
      throw e;
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

async function seed(userId) {
  const ds = buildDataset();
  const c = await userConn(userId);
  try {
    for (const sql of DDL) await c.query(sql);
    for (const [table, key] of [['customers', 'customers'], ['products', 'products'], ['orders', 'orders'], ['order_items', 'items']]) {
      const [sql, toRow] = INSERTS[table];
      for (const part of chunk(ds[key], 2000)) await c.query(sql, [part.map(toRow)]);
    }
    for (const t of ['customers', 'products', 'orders', 'order_items']) await c.query(`ANALYZE TABLE ${t}`);
  } finally {
    await c.end().catch(() => {});
  }
}

// Users can raise max_execution_time inside their session, so kill runaway queries from outside.
async function killThread(threadId) {
  let admin;
  try {
    admin = await adminConn();
    await admin.query(`KILL ${Number(threadId)}`);
  } catch { /* already gone */ } finally {
    await admin?.end().catch(() => {});
  }
}

// Stream rows so a huge result can never fill server memory; keep the first MAX_ROWS only.
function execStmt(raw, sql) {
  return new Promise(resolve => {
    const rows = [];
    let columns = null;
    let ok = null;
    let truncated = false;
    let done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => {
      killThread(raw.threadId);
      raw.destroy();
      finish({ kind: 'error', message: 'ERROR: query exceeded the 8 second lab limit' });
    }, 8000);
    const q = raw.query({ sql, rowsAsArray: true });
    // `fields` is emitted with undefined for statements that return no result set (INSERT, CREATE, ...)
    q.on('fields', f => { if (f && !columns) columns = f.map(c => c.name); });
    q.on('result', r => {
      if (Array.isArray(r)) {
        if (rows.length < MAX_ROWS) rows.push(r.map(ser)); else truncated = true;
      } else {
        ok = r;
      }
    });
    q.on('error', e => finish({ kind: 'error', message: `ERROR ${e.errno || ''} (${e.sqlState || 'HY000'}): ${e.sqlMessage || e.message}` }));
    q.on('end', () => {
      if (columns) return finish({ kind: 'table', columns, rows, rowCount: truncated ? null : rows.length, truncated });
      const n = ok?.affectedRows;
      finish({ kind: 'message', text: n != null ? `Query OK, ${n} row${n === 1 ? '' : 's'} affected${ok.info ? ` (${ok.info})` : ''}` : 'Query OK' });
    });
  });
}

export async function run(userId, input) {
  const statements = splitSql(input, { backslash: true });
  if (!statements.length) return [{ kind: 'message', text: 'Nothing to run.' }];
  if (statements.length > MAX_STATEMENTS) return [{ kind: 'error', message: `Too many statements (max ${MAX_STATEMENTS} per run).` }];

  const conn = await userConn(userId);
  const results = [];
  try {
    await conn.query('SET SESSION max_execution_time = 5000').catch(() => {});
    for (const sql of statements) {
      const r = await execStmt(conn.connection, sql);
      results.push(r);
      if (r.kind === 'error') break;
    }
  } finally {
    await conn.end().catch(() => {});
  }
  return results;
}

// Size of one learner's database in bytes (used for the sandbox size cap).
export async function size(userId) {
  const admin = await adminConn();
  try {
    await admin.query('SET SESSION information_schema_stats_expiry = 0').catch(() => {});
    const [rows] = await admin.query('SELECT COALESCE(SUM(data_length + index_length), 0) AS b FROM information_schema.tables WHERE table_schema = ?', [labName(userId)]);
    return Number(rows[0].b);
  } finally {
    await admin.end().catch(() => {});
  }
}

// Remove a learner's database and account (when the user is deleted).
export async function drop(userId) {
  const u = labName(userId);
  const admin = await adminConn();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${u}\``);
    await admin.query(`DROP USER IF EXISTS '${u}'@'%'`);
  } finally {
    await admin.end().catch(() => {});
  }
}
