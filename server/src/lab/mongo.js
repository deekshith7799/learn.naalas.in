import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { buildDataset, toMongo, chunk } from './seed.js';
import { parseMongo, splitMongoStatements } from './mongo-shell.js';
import { labCfg, labName, labPassword, MAX_ROWS, MAX_STATEMENTS, QUERY_MS } from './common.js';

const ENGINE = 'mongodb';
const { host, port, adminUser } = labCfg.mongo;

export function classify(e) {
  if (e?.code === 18 || e?.codeName === 'AuthenticationFailed' || /Authentication failed/i.test(e?.message || '')) return 'auth';
  if (['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError'].includes(e?.name)) return 'down';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e?.code)) return 'down';
  return null;
}

const opts = { serverSelectionTimeoutMS: 4000, connectTimeoutMS: 4000, socketTimeoutMS: 15000, maxPoolSize: 2 };
const adminClient = () =>
  new MongoClient(`mongodb://${adminUser}:${encodeURIComponent(labCfg.adminPassword)}@${host}:${port}/admin?authSource=admin`, opts);
const userClient = userId =>
  new MongoClient(`mongodb://${labName(userId)}:${labPassword(ENGINE, userId)}@${host}:${port}/${labName(userId)}?authSource=admin`, opts);

export async function provision(userId, { reset = false } = {}) {
  const user = labName(userId);
  const pwd = labPassword(ENGINE, userId);
  const client = adminClient();
  await client.connect();
  try {
    const admin = client.db('admin');
    const roles = [{ role: 'readWrite', db: user }];
    const info = await admin.command({ usersInfo: { user, db: 'admin' } });
    await admin.command(info.users.length ? { updateUser: user, pwd, roles } : { createUser: user, pwd, roles });

    const db = client.db(user);
    const seeded = (await db.listCollections({ name: 'orders' }, { nameOnly: true }).toArray()).length > 0;
    if (seeded && !reset) return;
    await db.dropDatabase();
    const data = toMongo(buildDataset());
    for (const name of ['customers', 'products', 'orders']) {
      for (const part of chunk(data[name], 2000)) await db.collection(name).insertMany(part);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

const plain = v => (v === undefined ? null : JSON.parse(EJSON.stringify(v)));
const json = (value, extra = {}) => ({ kind: 'json', value: plain(value), ...extra });

const HELP = `Supported commands (mongosh style):
  show collections
  db.<collection>.find(filter, projection).sort({ ... }).limit(n).skip(n)
  db.<collection>.findOne(...) | countDocuments(...) | distinct("field") | aggregate([ ... ])
  db.<collection>.insertOne(doc) | insertMany([ ... ]) | updateOne / updateMany / replaceOne | deleteOne / deleteMany
  db.<collection>.createIndex({ field: 1 }) | getIndexes() | dropIndex("name") | drop()
  db.<collection>.explain("executionStats").find({ ... })     (also works with aggregate)
Arguments are JSON-style (keys may be unquoted); ISODate("2025-01-31") and ObjectId("...") work.
Several commands can be run at once, one per line. Server-side JavaScript ($where, $function, $accumulator) is disabled.`;

// Server-side JavaScript is switched off on the lab server (--noscripting); give a clear message up front.
const BLOCKED = new Set(['$where', '$function', '$accumulator']);
export function assertNoScripting(v) {
  if (Array.isArray(v)) { v.forEach(assertNoScripting); return; }
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    for (const [k, x] of Object.entries(v)) {
      if (BLOCKED.has(k)) throw new Error(`${k} runs server-side JavaScript, which is disabled in the lab`);
      assertNoScripting(x);
    }
  }
}

async function exec(db, p) {
  if (p.op === 'help') return { kind: 'message', text: HELP };
  if (p.chain) for (const c of p.chain) (c.args || []).forEach(assertNoScripting);
  if (p.op === 'show-collections') {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort();
    return { kind: 'table', columns: ['collection'], rows: names.map(n => [n]), rowCount: names.length, truncated: false };
  }
  if (p.op === 'db-stats') return json(await db.command({ dbStats: 1, scale: 1024 }));

  const coll = db.collection(p.collection);
  let chain = p.chain;
  let explain = null;
  if (chain[0].name === 'explain') {
    explain = chain[0].args?.[0] ?? 'queryPlanner';
    chain = chain.slice(1);
    if (!chain.length) throw new Error('explain() must be followed by a method, e.g. .explain("executionStats").find({})');
  }
  const [head, ...rest] = chain;
  const a = head.args || [];
  const maxTimeMS = QUERY_MS;

  switch (head.name) {
    case 'find': {
      let cur = coll.find(a[0] ?? {}, { ...(a[1] ? { projection: a[1] } : {}), maxTimeMS });
      let userLimit = 0;
      let wantExplain = explain;
      for (const c of rest) {
        const x = c.args || [];
        if (c.name === 'sort') cur = cur.sort(x[0]);
        else if (c.name === 'limit') { userLimit = Number(x[0]) || 0; if (userLimit > 0) cur = cur.limit(Math.min(userLimit, MAX_ROWS + 1)); }
        else if (c.name === 'skip') cur = cur.skip(Number(x[0]) || 0);
        else if (c.name === 'project') cur = cur.project(x[0]);
        else if (c.name === 'explain') wantExplain = x[0] ?? 'queryPlanner';
        else if (c.name === 'count') return json(await coll.countDocuments(a[0] ?? {}, { maxTimeMS }));
        else if (['toArray', 'pretty'].includes(c.name)) continue;
        else throw new Error(`.${c.name}() is not supported in the lab`);
      }
      if (wantExplain) return json(await cur.explain(wantExplain));
      if (!userLimit) cur = cur.limit(MAX_ROWS + 1);
      return collect(cur);
    }
    case 'aggregate': {
      if (!Array.isArray(a[0])) throw new Error('aggregate() needs a pipeline array, e.g. aggregate([{ $match: {} }])');
      const cur = coll.aggregate(a[0], { maxTimeMS });
      let wantExplain = explain;
      for (const c of rest) {
        if (c.name === 'explain') wantExplain = c.args?.[0] ?? 'queryPlanner';
        else if (!['toArray', 'pretty'].includes(c.name)) throw new Error(`.${c.name}() is not supported after aggregate() in the lab`);
      }
      if (wantExplain) return json(await cur.explain(wantExplain));
      return collect(cur);
    }
    default:
  }

  if (explain) throw new Error('explain is supported for find() and aggregate() in the lab');
  switch (head.name) {
    case 'findOne': return json(await coll.findOne(a[0] ?? {}, { ...(a[1] ? { projection: a[1] } : {}), maxTimeMS }));
    case 'countDocuments': return json(await coll.countDocuments(a[0] ?? {}, { maxTimeMS }));
    case 'estimatedDocumentCount': return json(await coll.estimatedDocumentCount({ maxTimeMS }));
    case 'distinct': return json((await coll.distinct(a[0], a[1] ?? {}, { maxTimeMS })).slice(0, MAX_ROWS));
    case 'insertOne': return json(await coll.insertOne(a[0]));
    case 'insertMany': return json(await coll.insertMany(a[0]));
    case 'updateOne': return json(await coll.updateOne(a[0] ?? {}, a[1], a[2] ?? {}));
    case 'updateMany': return json(await coll.updateMany(a[0] ?? {}, a[1], a[2] ?? {}));
    case 'replaceOne': return json(await coll.replaceOne(a[0] ?? {}, a[1], a[2] ?? {}));
    case 'deleteOne': return json(await coll.deleteOne(a[0] ?? {}));
    case 'deleteMany': return json(await coll.deleteMany(a[0] ?? {}));
    case 'createIndex': return json(await coll.createIndex(a[0], a[1] ?? {}));
    case 'getIndexes': return json(await coll.indexes());
    case 'dropIndex': return json(await coll.dropIndex(a[0]));
    case 'drop': return json(await coll.drop());
    default: throw new Error(`${head.name}() is not supported in the lab. Type help to see what works.`);
  }
}

async function collect(cur) {
  const docs = [];
  let truncated = false;
  for await (const d of cur) {
    if (docs.length >= MAX_ROWS) { truncated = true; break; }
    docs.push(d);
  }
  await cur.close().catch(() => {});
  return json(docs, { count: docs.length, truncated });
}

export async function run(userId, input) {
  let statements;
  try { statements = splitMongoStatements(input); }
  catch (e) { return [{ kind: 'error', message: e.message }]; }
  if (!statements.length) return [{ kind: 'message', text: 'Nothing to run.' }];
  if (statements.length > MAX_STATEMENTS) return [{ kind: 'error', message: `Too many statements (max ${MAX_STATEMENTS} per run).` }];

  const client = userClient(userId);
  const results = [];
  try {
    await client.connect();
    const db = client.db(labName(userId));
    for (const s of statements) {
      try {
        results.push(await exec(db, parseMongo(s)));
      } catch (e) {
        if (classify(e)) throw e;
        results.push({ kind: 'error', message: `${e.name === 'Error' ? 'Error' : e.name}: ${e.message}` });
        break;
      }
    }
  } finally {
    await client.close().catch(() => {});
  }
  return results;
}

// Size of one learner's database in bytes (used for the sandbox size cap).
export async function size(userId) {
  const client = adminClient();
  await client.connect();
  try {
    const s = await client.db(labName(userId)).command({ dbStats: 1 });
    return Number(s.storageSize || 0) + Number(s.indexSize || 0);
  } finally {
    await client.close().catch(() => {});
  }
}

// Remove a learner's database and account (when the user is deleted).
export async function drop(userId) {
  const user = labName(userId);
  const client = adminClient();
  await client.connect();
  try {
    await client.db(user).dropDatabase();
    await client.db('admin').command({ dropUser: user }).catch(() => {});
  } finally {
    await client.close().catch(() => {});
  }
}
