import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import * as lab from './lab/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  DATABASE_URL,
  JWT_SECRET,
  ADMIN_EMAIL = 'admin@example.com',
  ADMIN_PASSWORD,
  PORT = 4000,
} = process.env;

// ---------- refuse to run with missing, weak or placeholder credentials ----------
const placeholder = v => /^change-this/i.test(String(v || '').trim());
const fatal = msg => {
  console.error(`\nCONFIG ERROR: ${msg}\nFix it in .env, then run:  docker compose up -d server\n`);
  process.exit(1);
};
if (!DATABASE_URL) fatal('DATABASE_URL is required.');
if (!JWT_SECRET || placeholder(JWT_SECRET)) fatal('JWT_SECRET is missing or still the placeholder from .env.example. Set a long random value (openssl rand -hex 32).');
if (JWT_SECRET.length < 16) fatal('JWT_SECRET is too short. Use at least 16 characters (openssl rand -hex 32).');
const SIGNUP_CODE_ENV = (process.env.SIGNUP_CODE || '').trim();
if (SIGNUP_CODE_ENV && (placeholder(SIGNUP_CODE_ENV) || SIGNUP_CODE_ENV.length < 6)) {
  fatal('SIGNUP_CODE is still the placeholder or shorter than 6 characters. Set your own team code, or leave it empty to turn sign-up off.');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
// An idle connection dropping (database restart, network blip) must not crash the app; the pool reconnects on demand.
pool.on('error', e => console.error('Database connection error:', e.message));
const q = (text, params) => pool.query(text, params);

async function init() {
  // wait for the database to accept connections
  for (let i = 0; i < 30; i++) {
    try { await q('SELECT 1'); break; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  await q(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const { rows } = await q('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    if (!ADMIN_PASSWORD || placeholder(ADMIN_PASSWORD) || ADMIN_PASSWORD.length < 8) {
      fatal('There are no users yet, so the first admin must be created, but ADMIN_PASSWORD is missing, shorter than 8 characters, or still the placeholder. Set a real ADMIN_PASSWORD.');
    }
    if (!ADMIN_EMAIL.includes('@') || /^(you|admin)@example\.com$/i.test(ADMIN_EMAIL.trim())) {
      fatal('ADMIN_EMAIL is missing or still the placeholder (you@example.com). Set the real email you will sign in with.');
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await q(
      "INSERT INTO users (email, name, password_hash, role, must_change) VALUES ($1, 'Admin', $2, 'admin', FALSE)",
      [ADMIN_EMAIL.toLowerCase(), hash]
    );
    console.log('Created admin user', ADMIN_EMAIL);
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50kb' }));

const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, mustChange: u.must_change });
const sign = u => jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '7d' });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { sub } = jwt.verify(token, JWT_SECRET);
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again' });
  }
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });

// ---------- auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  res.json({ token: sign(u), user: publicUser(u) });
}));

// ---------- team sign-up ----------
// Off unless SIGNUP_CODE is set. Anyone who knows the code can create a learner account (never an admin).
const SIGNUP_CODE = SIGNUP_CODE_ENV;
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const codeMatches = given => crypto.timingSafeEqual(sha(String(given || '').trim()), sha(SIGNUP_CODE));
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts. Try again in an hour.' },
});

app.get('/api/auth/config', (req, res) => res.json({ signup: !!SIGNUP_CODE }));

app.post('/api/auth/signup', signupLimiter, wrap(async (req, res) => {
  if (!SIGNUP_CODE) return res.status(403).json({ error: 'Sign-up is turned off. Ask your admin to create your account.' });
  const { name = '', email = '', password = '', code = '' } = req.body;
  if (!codeMatches(code)) return res.status(403).json({ error: 'Wrong team code. Ask your admin for it.' });
  const cleanName = String(name).trim();
  const cleanEmail = String(email).toLowerCase().trim();
  if (!cleanName || cleanName.length > 100) return res.status(400).json({ error: 'Enter your name (up to 100 characters)' });
  if (cleanEmail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (String(password).length < 8 || String(password).length > 72) return res.status(400).json({ error: 'Password must be 8 to 72 characters' });
  try {
    const { rows } = await q(
      "INSERT INTO users (email, name, password_hash, role, must_change) VALUES ($1, $2, $3, 'learner', FALSE) RETURNING *",
      [cleanEmail, cleanName, await bcrypt.hash(String(password), 12)]
    );
    res.json({ token: sign(rows[0]), user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email already has an account. Try signing in.' });
    throw e;
  }
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/change-password', auth, wrap(async (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body;
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await q('UPDATE users SET password_hash = $1, must_change = FALSE WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
}));

// ---------- progress ----------
app.get('/api/progress', auth, wrap(async (req, res) => {
  const { rows } = await q('SELECT lesson_id FROM progress WHERE user_id = $1', [req.user.id]);
  res.json({ completed: rows.map(r => r.lesson_id) });
}));

app.post('/api/progress/:lessonId', auth, wrap(async (req, res) => {
  const id = String(req.params.lessonId).slice(0, 100);
  await q('INSERT INTO progress (user_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
  res.json({ ok: true });
}));

app.delete('/api/progress/:lessonId', auth, wrap(async (req, res) => {
  await q('DELETE FROM progress WHERE user_id = $1 AND lesson_id = $2', [req.user.id, req.params.lessonId]);
  res.json({ ok: true });
}));

// ---------- admin ----------
const tempPassword = () => crypto.randomBytes(6).toString('base64url');

app.get('/api/admin/users', auth, adminOnly, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT u.id, u.email, u.name, u.role, u.must_change, u.created_at,
           count(p.lesson_id)::int AS completed,
           max(p.completed_at) AS last_activity
    FROM users u LEFT JOIN progress p ON p.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at`);
  res.json({ users: rows });
}));

app.post('/api/admin/users', auth, adminOnly, wrap(async (req, res) => {
  const { email = '', name = '', role = 'learner' } = req.body;
  if (!email.includes('@') || !name.trim()) return res.status(400).json({ error: 'Name and a valid email are required' });
  if (!['admin', 'learner'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  try {
    const { rows } = await q(
      'INSERT INTO users (email, name, password_hash, role, must_change) VALUES ($1, $2, $3, $4, TRUE) RETURNING *',
      [email.toLowerCase().trim(), name.trim(), hash, role]
    );
    res.json({ user: publicUser(rows[0]), tempPassword: pw });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email already exists' });
    throw e;
  }
}));

app.post('/api/admin/users/:id/reset', auth, adminOnly, wrap(async (req, res) => {
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  const { rowCount } = await q('UPDATE users SET password_hash = $1, must_change = TRUE WHERE id = $2', [hash, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'User not found' });
  res.json({ tempPassword: pw });
}));

app.delete('/api/admin/users/:id', auth, adminOnly, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  await q('DELETE FROM users WHERE id = $1', [req.params.id]);
  lab.dropUser(Number(req.params.id)).catch(() => {}); // remove their practice sandboxes in the background
  res.json({ ok: true });
}));

// ---------- practice lab ----------
const labLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: req => `u${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down: the lab allows 60 runs per minute.' },
});

const labGuard = (req, res, next) =>
  lab.ENGINES.includes(req.params.engine) ? next() : res.status(404).json({ error: 'Unknown lab' });

const labFail = (res, e) => {
  if (e.labUnavailable) return res.status(503).json({ error: e.message });
  throw e;
};

app.post('/api/lab/:engine/run', auth, labGuard, labLimiter, wrap(async (req, res) => {
  const input = String(req.body.input || '');
  if (!input.trim()) return res.status(400).json({ error: 'Type something to run' });
  if (input.length > 10000) return res.status(400).json({ error: 'Input too long (max 10,000 characters)' });
  const t0 = Date.now();
  try {
    const results = await lab.run(req.params.engine, req.user.id, input);
    res.json({ results, ms: Date.now() - t0 });
  } catch (e) { labFail(res, e); }
}));

app.post('/api/lab/:engine/reset', auth, labGuard, labLimiter, wrap(async (req, res) => {
  try {
    await lab.reset(req.params.engine, req.user.id);
    res.json({ ok: true });
  } catch (e) { labFail(res, e); }
}));

// Used by Docker's healthcheck and the watchdog: 200 only when the API can really reach its database.
app.get('/api/health', async (req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'database not reachable' });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

init().then(() => app.listen(PORT, () => console.log('API listening on', PORT)));
