// Splits a SQL script into statements, respecting quotes, comments and (for PostgreSQL) $$ bodies.
export function splitSql(input, { backslash = false, dollar = false } = {}) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    const d = input[i + 1];
    if (c === '-' && d === '-') {
      const e = input.indexOf('\n', i);
      const end = e < 0 ? n : e;
      cur += input.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = input.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      cur += input.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (backslash && input[j] === '\\') { j += 2; continue; }
        if (input[j] === c) {
          if (input[j + 1] === c) { j += 2; continue; } // doubled quote
          break;
        }
        j++;
      }
      cur += input.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (dollar && c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(input.slice(i, i + 64));
      const prev = input[i - 1] || '';
      if (m && !/[A-Za-z0-9_]/.test(prev)) {
        const close = input.indexOf(m[0], i + m[0].length);
        const end = close < 0 ? n : close + m[0].length;
        cur += input.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ';') {
      if (hasCode(cur)) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (hasCode(cur)) out.push(cur.trim());
  return out;
}

const hasCode = s => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0;
