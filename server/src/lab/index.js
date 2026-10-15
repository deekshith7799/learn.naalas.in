import { LabUnavailable, labCfg, MAX_SANDBOX_BYTES } from './common.js';
import * as postgresql from './pg.js';
import * as mysql from './mysql.js';
import * as mongodb from './mongo.js';

const impls = { postgresql, mysql, mongodb };
const NAMES = { postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB' };
export const ENGINES = Object.keys(impls);

const ready = new Set();
const locks = new Map();

// Serialize provisioning/reset per user+engine so two clicks can't collide.
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}

function wrap(engine, e) {
  if (e?.labUnavailable) return e;
  if (impls[engine].classify(e) === 'down') {
    return new LabUnavailable(`The ${NAMES[engine]} lab server is not reachable. On the server run: docker compose ps (the lab containers must be running).`);
  }
  console.error(`[lab:${engine}]`, e);
  return e;
}

async function ensure(engine, userId, { reset = false } = {}) {
  if (!labCfg.adminPassword) throw new LabUnavailable('The practice lab is not configured: set LAB_ADMIN_PASSWORD in .env and restart.');
  const key = `${engine}:${userId}`;
  if (!reset && ready.has(key)) return;
  await withLock(key, async () => {
    if (!reset && ready.has(key)) return;
    try {
      await impls[engine].provision(userId, { reset });
    } catch (e) {
      throw wrap(engine, e);
    }
    ready.add(key);
  });
}

export async function run(engine, userId, input) {
  await ensure(engine, userId);
  let results;
  try {
    results = await impls[engine].run(userId, input);
  } catch (e) {
    if (impls[engine].classify(e) === 'auth') {
      // credentials out of sync (e.g. lab container was recreated): re-provision once and retry
      ready.delete(`${engine}:${userId}`);
      await ensure(engine, userId);
      try { results = await impls[engine].run(userId, input); } catch (e2) { throw wrap(engine, e2); }
    } else {
      throw wrap(engine, e);
    }
  }
  await enforceQuota(engine, userId, results);
  return results;
}

export async function reset(engine, userId) {
  await ensure(engine, userId, { reset: true });
}

// Reads cannot grow a sandbox, so only check runs that returned a message or a document result.
// Over the cap -> reset to the sample data and tell the learner.
async function enforceQuota(engine, userId, results) {
  if (!results.some(r => r.kind === 'message' || r.kind === 'json')) return;
  let bytes;
  try {
    bytes = await impls[engine].size(userId);
  } catch (e) {
    console.error(`[lab:${engine}] size check failed:`, e.message);
    return;
  }
  if (bytes > MAX_SANDBOX_BYTES) {
    await reset(engine, userId);
    results.push({
      kind: 'error',
      message: `Your ${NAMES[engine]} sandbox grew past ${MAX_SANDBOX_BYTES / 1048576} MB, so it was reset to the sample data. Use smaller tables (add a LIMIT or a smaller generate_series / range).`,
    });
  }
}

// Remove a deleted user's sandboxes from every engine (best effort).
export async function dropUser(userId) {
  if (!labCfg.adminPassword) return;
  for (const engine of ENGINES) {
    ready.delete(`${engine}:${userId}`);
    try {
      await withLock(`${engine}:${userId}`, () => impls[engine].drop(userId));
    } catch (e) {
      console.error(`[lab:${engine}] cleanup for user ${userId} skipped:`, e.message);
    }
  }
}
