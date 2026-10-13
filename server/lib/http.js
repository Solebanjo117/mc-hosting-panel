import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { USER_AGENT } from '../config.js';
import { HttpError } from './util.js';

/**
 * Solo para pruebas: MCP_URL_REWRITE={"https://api.modrinth.com":"http://127.0.0.1:1234/modrinth", ...}
 * redirige las llamadas a internet hacia servicios simulados.
 */
const REWRITE = (() => {
  try {
    return Object.entries(JSON.parse(process.env.MCP_URL_REWRITE || '{}'));
  } catch {
    return [];
  }
})();

export function rewriteUrl(url) {
  for (const [from, to] of REWRITE) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
}

function headers(extra = {}) {
  return { 'User-Agent': USER_AGENT, ...extra };
}

async function request(rawUrl, { timeout = 20000, ...opts } = {}) {
  const url = rewriteUrl(rawUrl);
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: headers(opts.headers),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new HttpError(502, `No se pudo conectar a ${new URL(url).host}: ${err.cause?.code || err.message}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* sin cuerpo */
    }
    throw new HttpError(res.status === 404 ? 404 : 502, `${new URL(url).host} respondió ${res.status} ${detail}`.trim());
  }
  return res;
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  return res.json();
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

/**
 * Descarga un archivo a disco reportando progreso (0-1).
 * Escribe primero a .part para no dejar archivos a medias.
 */
export async function download(url, dest, onProgress = () => {}) {
  const res = await request(url, { timeout: 30 * 60 * 1000 });
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - lastReport > 250) {
        lastReport = now;
        onProgress(total ? received / total : null, received, total);
      }
      cb(null, chunk);
    },
  });
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
  await fs.promises.rename(part, dest);
  onProgress(1, received, total);
  return { url: res.url, size: received };
}
