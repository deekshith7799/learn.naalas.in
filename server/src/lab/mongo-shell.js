// Parser for a safe subset of mongosh syntax: db.<collection>.<method>(args).<cursorMethod>(args)
import JSON5 from 'json5';
import { EJSON } from 'bson';

export function splitMongoStatements(input) {
  const out = [];
  let cur = '';
  let depth = 0;
  let q = null;
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += input[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      i--;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && c === ';') { push(); continue; }
    if (depth === 0 && c === '\n') {
      if (input.slice(i + 1).trimStart().startsWith('.')) { cur += c; continue; } // chained call on next line
      push();
      continue;
    }
    cur += c;
  }
  push();
  return out;
}

function matchParen(s, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { depth--; if (depth === 0) return i; }
  }
  throw new Error('Unbalanced brackets: check your ( ) [ ] { }');
}

function splitArgs(text) {
  const args = [];
  let cur = '';
  let depth = 0;
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === '\\') cur += text[++i] ?? ''; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

const QUOTED = '("[^"]*"|\'[^\']*\')';
function preprocess(t) {
  return t
    .replace(/\bnew\s+Date\(\s*\)/g, () => `{"$date":"${new Date().toISOString()}"}`)
    .replace(new RegExp(`\\b(?:new\\s+Date|ISODate)\\(\\s*${QUOTED}\\s*\\)`, 'g'), (_, s) => `{"$date":${s}}`)
    .replace(new RegExp(`\\b(?:new\\s+)?ObjectId\\(\\s*${QUOTED}\\s*\\)`, 'g'), (_, s) => `{"$oid":${s}}`)
    .replace(/\b(?:NumberInt|NumberLong|NumberDecimal)\(\s*["']?(-?[\d.]+)["']?\s*\)/g, (_, n) => n);
}

function parseArg(text, where) {
  try {
    const v = JSON5.parse(preprocess(text));
    return v && typeof v === 'object' ? EJSON.deserialize(v) : v;
  } catch (e) {
    throw new Error(`Could not read the argument of ${where}: ${String(e.message).split('\n')[0]}`);
  }
}

function readChain(s, i) {
  const calls = [];
  while (i < s.length) {
    while (/\s/.test(s[i] || '')) i++;
    if (i >= s.length) break;
    if (s[i] !== '.') throw new Error(`Unexpected "${s[i]}" in the command`);
    i++;
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
    if (!m) throw new Error('Expected a name after "."');
    const name = m[0];
    i += name.length;
    let args = null;
    if (s[i] === '(') {
      const end = matchParen(s, i);
      args = splitArgs(s.slice(i + 1, end)).map((a, k) => parseArg(a, `${name}() argument ${k + 1}`));
      i = end + 1;
    }
    calls.push({ name, args });
  }
  return calls;
}

export function parseMongo(statement) {
  const s = statement.trim().replace(/;+$/, '');
  if (/^help$/i.test(s)) return { op: 'help' };
  if (/^show\s+(collections|tables)$/i.test(s)) return { op: 'show-collections' };
  if (/^use\s+/i.test(s)) throw new Error('`use` is not needed: your lab database is already selected as db.');
  if (/^db\.getCollectionNames\(\s*\)$/.test(s)) return { op: 'show-collections' };
  if (/^db\.stats\(\s*\)$/.test(s)) return { op: 'db-stats' };
  if (!s.startsWith('db.')) throw new Error('Commands start with db. (for example db.orders.find({}) ). Type help to see what works here.');

  const chain = readChain(s, 2);
  if (!chain.length) throw new Error('Incomplete command');
  let collection;
  if (chain[0].name === 'getCollection') {
    collection = chain[0].args?.[0];
    if (typeof collection !== 'string') throw new Error('db.getCollection("name") needs a collection name');
  } else if (chain[0].args === null) {
    collection = chain[0].name;
  } else {
    throw new Error(`db.${chain[0].name}() is not supported in the lab. Type help to see what works.`);
  }
  const calls = chain.slice(1);
  if (!calls.length) throw new Error(`db.${collection} needs a method, e.g. db.${collection}.find({})`);
  return { op: 'coll', collection, chain: calls };
}
