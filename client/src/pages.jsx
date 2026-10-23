import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth.js';
import { api } from './api.js';
import { ALL_LESSONS, COMPARE, DBS } from './content.js';

/* ---------- Login ---------- */
export function Login() {
  const { login, open } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupOn, setSignupOn] = useState(false);
  useEffect(() => { api('/auth/config').then(c => setSignupOn(!!c.signup)).catch(() => {}); }, []);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>DBA Academy</h1>
        <p className="muted">PostgreSQL · MySQL · MongoDB. {signupOn ? 'Sign in, or create an account with the team code from your admin.' : 'Sign in with the account your admin created.'}</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        {signupOn && !open && <p className="alt muted">New here? <Link to="/signup">Create an account</Link></p>}
        {open && <p className="alt muted"><Link to="/">Back to the site</Link> (no login needed for learners)</p>}
      </form>
    </div>
  );
}

/* ---------- Sign up (needs the team code from your admin) ---------- */
export function Signup() {
  const { signup } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' });
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/auth/config').then(c => setEnabled(!!c.signup)).catch(() => setEnabled(true)); }, []);
  if (enabled === false) return <Navigate to="/login" replace />;

  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await signup(f); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">Ask your admin for the team code.</p>
        <label>Full name<input value={f.name} onChange={set('name')} required maxLength={100} autoFocus /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        <label>Password (8 or more characters)<input type="password" value={f.password} onChange={set('password')} required minLength={8} maxLength={72} autoComplete="new-password" /></label>
        <label>Team code<input value={f.code} onChange={set('code')} required autoComplete="off" /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
        <p className="alt muted">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

/* ---------- Change password ---------- */
export function ChangePassword() {
  const { user, reload } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCur] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async e => {
    e.preventDefault(); setError(''); setOk(false);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      await reload();
      setOk(true); setCur(''); setNew('');
      if (user.mustChange) navigate('/');
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page narrow">
      <h2>Change password</h2>
      {user.mustChange && <p className="notice">Please set your own password before continuing.</p>}
      <form className="card" onSubmit={submit}>
        <label>Current password<input type="password" value={currentPassword} onChange={e => setCur(e.target.value)} required /></label>
        <label>New password (min 8 characters)<input type="password" value={newPassword} onChange={e => setNew(e.target.value)} required minLength={8} /></label>
        {error && <div className="error">{error}</div>}
        {ok && <div className="success">Password updated.</div>}
        <button className="primary">Update password</button>
      </form>
    </div>
  );
}

/* ---------- Dashboard ---------- */
export function Dashboard() {
  const { user, completed } = useAuth();
  const total = ALL_LESSONS.length;
  const done = ALL_LESSONS.filter(l => completed.has(l.id)).length;
  return (
    <div className="page">
      <h2>Welcome, {user.name.split(' ')[0]}</h2>
      <p className="muted">Overall progress: {done} of {total} lessons ({Math.round((done / total) * 100)}%)</p>
      <Bar value={done / total} />
      <div className="grid">
        {DBS.map(db => {
          const d = db.lessons.filter(l => completed.has(l.id)).length;
          return (
            <Link key={db.key} to={`/db/${db.key}`} className="card db-card" style={{ borderTopColor: db.color }}>
              <h3>{db.name}</h3>
              <p className="muted">{db.blurb}</p>
              <Bar value={d / db.lessons.length} color={db.color} />
              <small>{d}/{db.lessons.length} lessons</small>
            </Link>
          );
        })}
      </div>
      <Link to="/compare" className="card compare-cta">
        <strong>Compare view</strong>
        <span className="muted"> Same task side by side in all three databases.</span>
      </Link>
    </div>
  );
}

function Bar({ value, color }) {
  return (
    <div className="bar"><div style={{ width: `${Math.round(value * 100)}%`, background: color }} /></div>
  );
}

/* ---------- Database page + lesson ---------- */
export function DbPage() {
  const { db: key, lesson: lessonId } = useParams();
  const { completed, toggle } = useAuth();
  const db = DBS.find(d => d.key === key);
  if (!db) return <Navigate to="/" replace />;
  const lesson = db.lessons.find(l => l.id === lessonId) || db.lessons[0];
  const idx = db.lessons.indexOf(lesson);
  const next = db.lessons[idx + 1];
  const prev = db.lessons[idx - 1];
  const isDone = completed.has(lesson.id);

  return (
    <div className="page lesson-layout">
      <aside>
        <h3 style={{ color: db.color }}>{db.name}</h3>
        <ol className="toc">
          {db.lessons.map(l => (
            <li key={l.id} className={l.id === lesson.id ? 'active' : ''}>
              <Link to={`/db/${db.key}/${l.id}`}>
                <span className={'tick' + (completed.has(l.id) ? ' on' : '')}>{completed.has(l.id) ? '✓' : ''}</span>
                {l.title}
              </Link>
            </li>
          ))}
        </ol>
      </aside>
      <article className="card">
        <h2>{lesson.title}</h2>
        <p className="analogy"><strong>Think of it like this:</strong> {lesson.analogy}</p>
        <h4>Key points</h4>
        <ul>{lesson.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        <h4>Try it</h4>
        <CodeBlock code={lesson.code} lang={lesson.lang} />
        <p><Link to={`/lab/${db.key}`}>Practice {db.name} in the lab →</Link></p>
        <div className="lesson-actions">
          {prev ? <Link className="btn" to={`/db/${db.key}/${prev.id}`}>← Previous</Link> : <span />}
          <button className={isDone ? 'btn done' : 'primary'} onClick={() => toggle(lesson.id)}>
            {isDone ? '✓ Completed (click to undo)' : 'Mark as complete'}
          </button>
          {next ? <Link className="btn" to={`/db/${db.key}/${next.id}`}>Next →</Link> : <span />}
        </div>
      </article>
    </div>
  );
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="code">
      <div className="code-head"><span>{lang}</span><button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

/* ---------- Compare ---------- */
export function Compare() {
  const [q, setQ] = useState('');
  const rows = COMPARE.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <h2>Compare: same task, three databases</h2>
      <input className="search" placeholder="Filter (e.g. backup, index, replication)" value={q} onChange={e => setQ(e.target.value)} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Task</th>{DBS.map(d => <th key={d.key} style={{ color: d.color }}>{d.name}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.task}>
                <td><strong>{r.task}</strong></td>
                <td><code>{r.postgresql}</code></td>
                <td><code>{r.mysql}</code></td>
                <td><code>{r.mongodb}</code></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">No match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Admin ---------- */
export function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', role: 'learner' });
  const [error, setError] = useState('');
  const [issued, setIssued] = useState(null);
  const total = ALL_LESSONS.length;

  const refresh = async () => setUsers((await api('/admin/users')).users);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);

  const add = async e => {
    e.preventDefault(); setError('');
    try {
      const r = await api('/admin/users', { method: 'POST', body: form });
      setIssued({ email: r.user.email, password: r.tempPassword });
      setForm({ name: '', email: '', role: 'learner' });
      refresh();
    } catch (err) { setError(err.message); }
  };
  const reset = async u => {
    if (!confirm(`Reset password for ${u.email}?`)) return;
    const r = await api(`/admin/users/${u.id}/reset`, { method: 'POST' });
    setIssued({ email: u.email, password: r.tempPassword });
  };
  const remove = async u => {
    if (!confirm(`Delete ${u.email} and their progress?`)) return;
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); refresh(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="page">
      <h2>Team admin</h2>
      <form className="card inline-form" onSubmit={add}>
        <input placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
        <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="learner">Learner</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary">Add member</button>
      </form>
      {error && <div className="error">{error}</div>}
      {issued && (
        <div className="notice">
          Temporary password for <strong>{issued.email}</strong>: <code>{issued.password}</code>
          <br /><small>Share it privately. It is shown only once and must be changed at first login.</small>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Progress</th><th>Last activity</th><th></th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td style={{ minWidth: 140 }}>
                  <Bar value={u.completed / total} />
                  <small>{u.completed}/{total}</small>
                </td>
                <td>{u.last_activity ? new Date(u.last_activity).toLocaleDateString() : '-'}</td>
                <td className="actions">
                  <button className="link" onClick={() => reset(u)}>Reset password</button>
                  {u.id !== user.id && <button className="link danger" onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
