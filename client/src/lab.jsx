import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { api } from './api.js';
import { LAB, LAB_LIMITS } from './labContent.js';

const HISTORY_MAX = 15;
const histKey = engine => `lab-history-${engine}`;
const readHistory = engine => {
  try { return JSON.parse(localStorage.getItem(histKey(engine)) || '[]'); } catch { return []; }
};
const writeHistory = (engine, list) => {
  try { localStorage.setItem(histKey(engine), JSON.stringify(list)); } catch { /* storage unavailable: history is a convenience only */ }
};

export default function LabRoute() {
  const { engine } = useParams();
  if (!LAB[engine]) return <Navigate to="/lab/postgresql" replace />;
  // key: switching engine starts with a fresh editor and results
  return <Lab key={engine} engine={engine} meta={LAB[engine]} />;
}

function Lab({ engine, meta }) {
  const [input, setInput] = useState(meta.starter);
  const [results, setResults] = useState(null);
  const [ms, setMs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(() => readHistory(engine));
  const [openSolution, setOpenSolution] = useState({});
  const editorRef = useRef(null);

  const load = code => {
    setInput(code);
    editorRef.current?.focus();
  };

  const remember = text => {
    const next = [text, ...history.filter(h => h !== text)].slice(0, HISTORY_MAX);
    setHistory(next);
    writeHistory(engine, next);
  };

  const run = async () => {
    const text = input.trim();
    if (busy || !text) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(`/lab/${engine}/run`, { method: 'POST', body: { input: text } });
      setResults(r.results);
      setMs(r.ms);
      remember(text);
    } catch (e) {
      setResults(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    if (!confirm(`Reset your ${meta.name} sandbox to the original sample data? Anything you created or changed there will be lost.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/lab/${engine}/reset`, { method: 'POST' });
      setResults([{ kind: 'message', text: 'Your sandbox was reset to the sample data.' }]);
      setMs(null);
    } catch (e) {
      setResults(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="page lab-page">
      <h2>Practice lab</h2>
      <div className="lab-tabs" role="tablist" aria-label="Database">
        {Object.entries(LAB).map(([key, m]) => (
          <NavLink key={key} to={`/lab/${key}`} role="tab" style={({ isActive }) => (isActive ? { borderBottomColor: m.color } : undefined)}>
            {m.name}
          </NavLink>
        ))}
      </div>

      <div className="lab">
        <aside className="lab-side">
          <section>
            <h4>Sample data</h4>
            <p className="muted small">A small online shop. It is your own private copy: change anything you like.</p>
            <ul className="schema">
              {meta.tables.map(t => (
                <li key={t.name}>
                  <strong>{t.name}</strong> <span className="muted small">{t.note}</span>
                  <div className="cols">{t.cols.join(', ')}</div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Examples</h4>
            <ul className="plain">
              {meta.examples.map(ex => (
                <li key={ex.title}><button className="link left" onClick={() => load(ex.code)}>{ex.title}</button></li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Exercises</h4>
            <ol className="exercises">
              {meta.exercises.map((ex, i) => (
                <li key={ex.title}>
                  <strong>{ex.title}</strong>
                  <p>{ex.task}</p>
                  <p className="muted small">Hint: {ex.hint}</p>
                  <button className="link" onClick={() => setOpenSolution(s => ({ ...s, [i]: !s[i] }))}>
                    {openSolution[i] ? 'Hide solution' : 'Show solution'}
                  </button>
                  {openSolution[i] && (
                    <div className="solution">
                      <pre>{ex.solution}</pre>
                      <button className="link" onClick={() => load(ex.solution)}>Load into editor</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {history.length > 0 && (
            <section>
              <h4>Recent</h4>
              <ul className="plain">
                {history.map(h => (
                  <li key={h}><button className="link left mono" title={h} onClick={() => load(h)}>{h.replace(/\s+/g, ' ').slice(0, 48)}</button></li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="lab-main">
          <label className="sr-only" htmlFor="lab-editor">{meta.name} {meta.kind} editor</label>
          <textarea
            id="lab-editor"
            ref={editorRef}
            className="editor"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={9}
          />
          <div className="lab-actions">
            <button className="primary" onClick={run} disabled={busy || !input.trim()}>{busy ? 'Running...' : 'Run'}</button>
            <span className="muted small">Ctrl + Enter</span>
            <span className="grow" />
            <button className="btn" onClick={() => setInput('')} disabled={busy}>Clear</button>
            <button className="btn" onClick={reset} disabled={busy}>Reset sandbox</button>
          </div>
          <ul className="tips muted small">
            {meta.tips.map(t => <li key={t}>{t}</li>)}
            <li>{LAB_LIMITS}</li>
          </ul>

          <div className="results" aria-live="polite">
            {error && <div className="res-err">{error}</div>}
            {results && results.map((r, i) => <Result key={i} r={r} index={i} total={results.length} />)}
            {results && ms != null && <div className="muted small">Finished in {ms} ms</div>}
            {!results && !error && <div className="muted">Results appear here.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Result({ r, index, total }) {
  const label = total > 1 ? <div className="res-label">Result {index + 1} of {total}</div> : null;

  if (r.kind === 'error') return <div>{label}<pre className="res-err">{r.message}</pre></div>;
  if (r.kind === 'message') return <div>{label}<pre className="res-msg">{r.text}</pre></div>;
  if (r.kind === 'json') {
    return (
      <div>
        {label}
        <pre className="json">{JSON.stringify(r.value, null, 2)}</pre>
        {Array.isArray(r.value) && <div className="muted small">{r.truncated ? `First ${r.count} documents shown (more exist). Add a filter or $limit.` : `${r.value.length} document${r.value.length === 1 ? '' : 's'}`}</div>}
      </div>
    );
  }
  // table
  return (
    <div>
      {label}
      <div className="table-wrap result-table">
        <table>
          <thead><tr>{r.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={j}><Cell v={v} /></td>)}</tr>
            ))}
            {!r.rows.length && <tr><td colSpan={Math.max(1, r.columns.length)} className="muted">No rows.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="muted small">{r.truncated ? `First ${r.rows.length} rows shown (more exist). Add a WHERE or LIMIT.` : `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`}</div>
    </div>
  );
}

function Cell({ v }) {
  if (v === null || v === undefined) return <span className="null">NULL</span>;
  if (typeof v === 'object') return <code>{JSON.stringify(v)}</code>;
  return String(v);
}
