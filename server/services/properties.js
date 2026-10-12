import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';

/**
 * Lector/escritor de server.properties que conserva comentarios y orden.
 * Sigue el formato .properties de Java (escapes \: \= \uXXXX).
 */

function unescape(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, seq) => {
    if (seq[0] === 'u' && seq.length === 5) return String.fromCharCode(parseInt(seq.slice(1), 16));
    if (seq === 'n') return '\n';
    if (seq === 't') return '\t';
    return seq;
  });
}

function escape(value) {
  let out = '';
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === ':' || ch === '=') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (code > 0x7e || code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

export function parseProperties(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      entries.push({ raw: line });
      continue;
    }
    const m = line.match(/^\s*((?:\\.|[^=:\s])+)\s*[=:]?\s*(.*)$/);
    if (!m) {
      entries.push({ raw: line });
      continue;
    }
    entries.push({ key: unescape(m[1]), value: unescape(m[2]) });
  }
  return entries;
}

export function serializeProperties(entries) {
  return (
    entries
      .map((e) => (e.key !== undefined ? `${e.key}=${escape(e.value)}` : e.raw))
      .join('\n')
      .replace(/\n+$/, '') + '\n'
  );
}

const file = (id) => path.join(serverDir(id), 'server.properties');

export function readProperties(id) {
  const f = file(id);
  if (!fs.existsSync(f)) return {};
  const obj = {};
  for (const e of parseProperties(fs.readFileSync(f, 'utf8'))) if (e.key !== undefined) obj[e.key] = e.value;
  return obj;
}

/** Actualiza (o agrega) claves sin perder las demás. */
export function writeProperties(id, values) {
  const f = file(id);
  const entries = fs.existsSync(f) ? parseProperties(fs.readFileSync(f, 'utf8')) : [{ raw: '#Minecraft server properties' }];
  const pending = new Map(Object.entries(values).map(([k, v]) => [k, v == null ? '' : String(v)]));
  for (const e of entries) {
    if (e.key !== undefined && pending.has(e.key)) {
      e.value = pending.get(e.key);
      pending.delete(e.key);
    }
  }
  while (entries.length && entries.at(-1).key === undefined && !entries.at(-1).raw.trim()) entries.pop();
  for (const [key, value] of pending) entries.push({ key, value });
  fs.writeFileSync(f, serializeProperties(entries));
  return readProperties(id);
}
