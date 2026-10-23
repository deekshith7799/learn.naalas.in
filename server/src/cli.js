// Admin CLI for DBA Academy. Run inside the server container, usually via the `academy` wrapper.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

const [cmd, ...args] = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const tempPassword = () => crypto.randomBytes(6).toString('base64url');
const fail = msg => { console.error('Error: ' + msg); process.exitCode = 1; };

const HELP = `DBA Academy admin CLI

  users                              List all users with progress
  add-user <email> <name> [--role admin|learner]
                                     Create a user (prints a temporary password)
  reset-password <email>             Issue a new temporary password
  set-role <email> <admin|learner>   Change a user's role
  delete-user <email>                Delete a user and their progress
  progress <email>                   Completed lessons for one user
  stats                              Team totals and most-completed lessons
  db-status                          Database size, connections, table sizes
  help                               Show this help

Wrapper extras:  academy backup | restore <file> | psql | logs`;

async function findUser(email) {
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
  return rows[0];
}

const commands = {
  async users() {
    const { rows } = await q(`
      SELECT u.id, u.email, u.name, u.role, count(p.lesson_id)::int AS completed,
             to_char(max(p.completed_at), 'YYYY-MM-DD') AS last_activity
      FROM users u LEFT JOIN progress p ON p.user_id = u.id
      WHERE u.email NOT LIKE '%@guest.local'
      GROUP BY u.id ORDER BY u.id`);
    console.table(rows);
  },

  async 'add-user'() {
    const [email, ...nameParts] = pos;
    const name = nameParts.join(' ');
    const role = flag('role') || 'learner';
    if (!email || !email.includes('@') || !name) return fail('usage: add-user <email> <name> [--role admin|learner]');
    if (!['admin', 'learner'].includes(role)) return fail('role must be admin or learner');
    const pw = tempPassword();
    try {
      await q(
        'INSERT INTO users (email, name, password_hash, role, must_change) VALUES ($1, $2, $3, $4, TRUE)',
        [email.toLowerCase(), name, await bcrypt.hash(pw, 12), role]
      );
    } catch (e) {
      return fail(e.code === '23505' ? 'that email already exists' : e.message);
    }
    console.log(`Created ${role} ${email}\nTemporary password: ${pw}\n(They must change it at first login.)`);
  },

  async 'reset-password'() {
    const u = await findUser(pos[0]);
    if (!u) return fail('user not found');
    const pw = tempPassword();
    await q('UPDATE users SET password_hash = $1, must_change = TRUE WHERE id = $2', [await bcrypt.hash(pw, 12), u.id]);
    console.log(`New temporary password for ${u.email}: ${pw}`);
  },

  async 'set-role'() {
    const [email, role] = pos;
    if (!['admin', 'learner'].includes(role)) return fail('usage: set-role <email> <admin|learner>');
    const { rowCount } = await q('UPDATE users SET role = $1 WHERE email = $2', [role, (email || '').toLowerCase()]);
    rowCount ? console.log(`${email} is now ${role}`) : fail('user not found');
  },

  async 'delete-user'() {
    const { rows } = await q('DELETE FROM users WHERE email = $1 RETURNING id', [(pos[0] || '').toLowerCase()]);
    if (!rows.length) return fail('user not found');
    console.log(`Deleted ${pos[0]} and their progress`);
    try {
      const lab = await import('./lab/index.js');
      await lab.dropUser(rows[0].id);
      console.log('Removed their practice sandboxes');
    } catch (e) {
      console.log('Practice sandboxes were not removed: ' + e.message);
    }
  },

  async progress() {
    const u = await findUser(pos[0]);
    if (!u) return fail('usage: progress <email> (user not found)');
    const { rows } = await q(
      "SELECT lesson_id, to_char(completed_at, 'YYYY-MM-DD HH24:MI') AS completed_at FROM progress WHERE user_id = $1 ORDER BY completed_at",
      [u.id]
    );
    console.log(`${u.name} <${u.email}>: ${rows.length} lessons completed`);
    if (rows.length) console.table(rows);
  },

  async stats() {
    const { rows: [t] } = await q(`
      SELECT (SELECT count(*) FROM users WHERE email NOT LIKE '%@guest.local')::int AS users,
             (SELECT count(*) FROM users WHERE email LIKE '%@guest.local')::int AS guests,
             (SELECT count(*) FROM users WHERE role = 'admin')::int AS admins,
             (SELECT count(*) FROM progress)::int AS completions,
             (SELECT count(DISTINCT user_id) FROM progress WHERE completed_at > now() - interval '7 days')::int AS active_7d`);
    console.table([t]);
    const { rows } = await q('SELECT lesson_id, count(*)::int AS completions FROM progress GROUP BY lesson_id ORDER BY 2 DESC, 1 LIMIT 5');
    console.log('Most completed lessons:');
    console.table(rows);
  },

  async 'db-status'() {
    const { rows: [i] } = await q(`
      SELECT split_part(version(), ' ', 2) AS pg_version,
             pg_size_pretty(pg_database_size(current_database())) AS db_size,
             date_trunc('second', now() - pg_postmaster_start_time())::text AS uptime`);
    console.table([i]);
    console.log('Connections by state:');
    console.table((await q('SELECT coalesce(state, \'background\') AS state, count(*)::int AS n FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC')).rows);
    console.log('Tables:');
    console.table((await q(`
      SELECT relname AS table, n_live_tup AS live_rows, n_dead_tup AS dead_rows,
             pg_size_pretty(pg_total_relation_size(relid)) AS size
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`)).rows);
  },

  async help() { console.log(HELP); },
};

try {
  if (!cmd || !commands[cmd]) {
    console.log(HELP);
    if (cmd) process.exitCode = 1;
  } else {
    await commands[cmd]();
  }
} catch (e) {
  fail(e.message);
} finally {
  await pool.end();
}
