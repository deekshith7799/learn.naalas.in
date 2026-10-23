import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import { AuthCtx, useAuth } from './auth.js';
import { Admin, ChangePassword, Compare, Dashboard, DbPage, Login, Signup } from './pages.jsx';
import LabRoute from './lab.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [completed, setCompleted] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); // open access: no login, every visitor is a guest

  const load = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      const p = await api('/progress');
      setUser(me.user);
      setCompleted(new Set(p.completed));
      return true;
    } catch {
      setToken(null);
      setUser(null);
      return false;
    }
  }, []);

  // On start: use the saved sign-in if it still works; otherwise, in open-access mode, become a guest.
  useEffect(() => {
    (async () => {
      let ok = getToken() ? await load() : false;
      const cfg = await api('/auth/config').catch(() => ({}));
      setOpen(!!cfg.open);
      if (!ok && cfg.open) {
        try {
          const r = await api('/auth/guest', { method: 'POST' });
          setToken(r.token);
          ok = await load();
        } catch { /* fall through to the login page */ }
      }
      setLoading(false);
    })();
  }, [load]);

  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token);
    await load();
  };
  const signup = async body => {
    const r = await api('/auth/signup', { method: 'POST', body });
    setToken(r.token);
    await load();
  };
  const logout = () => {
    setToken(null); setUser(null); setCompleted(new Set());
    if (open) window.location.assign('/'); // open access: start again as a fresh guest
  };

  const toggle = async id => {
    const done = completed.has(id);
    const next = new Set(completed);
    done ? next.delete(id) : next.add(id);
    setCompleted(next); // optimistic
    try {
      await api('/progress/' + id, { method: done ? 'DELETE' : 'POST' });
    } catch {
      setCompleted(completed);
    }
  };

  if (loading) return <div className="center muted">Loading...</div>;

  return (
    <AuthCtx.Provider value={{ user, completed, open, login, signup, logout, toggle, reload: load }}>
      <Routes>
        <Route path="/login" element={user && !user.guest ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/signup" element={user && !user.guest ? <Navigate to="/" replace /> : <Signup />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/db/:db" element={<DbPage />} />
          <Route path="/db/:db/:lesson" element={<DbPage />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/lab" element={<Navigate to="/lab/postgresql" replace />} />
          <Route path="/lab/:engine" element={<LabRoute />} />
          <Route path="/account" element={<ChangePassword />} />
          <Route path="/admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

function Protected() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChange && pathname !== '/account') return <Navigate to="/account" replace />;
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">DBA Academy</NavLink>
        <nav>
          <NavLink to="/db/postgresql">PostgreSQL</NavLink>
          <NavLink to="/db/mysql">MySQL</NavLink>
          <NavLink to="/db/mongodb">MongoDB</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/lab">Practice</NavLink>
          {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="who">
          {user.guest ? (
            <>
              <span className="muted">Guest</span>
              <NavLink to="/login">Admin login</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/account">{user.name}</NavLink>
              <button className="link" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
            </>
          )}
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
