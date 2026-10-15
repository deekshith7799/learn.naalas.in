import crypto from 'crypto';

export const MAX_ROWS = 200;
export const MAX_STATEMENTS = 20;
export const QUERY_MS = 5000;
// A learner's sandbox is reset to the sample data when it grows past this (protects the server disk).
export const MAX_SANDBOX_BYTES = 128 * 1024 * 1024;

const env = process.env;
export const labCfg = {
  adminPassword: env.LAB_ADMIN_PASSWORD || '',
  secret: env.LAB_SECRET || env.JWT_SECRET || '',
  pg: { host: env.LAB_PG_HOST || 'pg-lab', port: Number(env.LAB_PG_PORT || 5432), adminUser: env.LAB_PG_ADMIN_USER || 'postgres' },
  mysql: { host: env.LAB_MYSQL_HOST || 'mysql-lab', port: Number(env.LAB_MYSQL_PORT || 3306), adminUser: env.LAB_MYSQL_ADMIN_USER || 'root' },
  mongo: { host: env.LAB_MONGO_HOST || 'mongo-lab', port: Number(env.LAB_MONGO_PORT || 27017), adminUser: env.LAB_MONGO_ADMIN_USER || 'root' },
};

// Each person's lab credentials are derived, never stored: HMAC(secret, engine + user id).
export const labPassword = (engine, userId) =>
  crypto.createHmac('sha256', labCfg.secret).update(`lab:${engine}:${userId}`).digest('hex').slice(0, 32);

export const labName = userId => {
  if (!Number.isInteger(userId) || userId < 1) throw new Error('bad user id');
  return `lab_u${userId}`;
};

export class LabUnavailable extends Error {
  constructor(message) { super(message); this.labUnavailable = true; }
}

// Make any driver value safe to send as JSON.
export function ser(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(ser);
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)));
  return v;
}
