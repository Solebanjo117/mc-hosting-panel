// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';

/**
 * Los tokens de otros servicios (Cloudflare, deSEC, DuckDNS, CurseForge) se guardan cifrados en db.json.
 * La clave vive aparte, en data/panel.key (solo la lee el usuario de esta PC): así, si alguien comparte
 * su db.json para pedir ayuda o lo copia a otro lado, los tokens no van en claro.
 * Si la clave se pierde, los tokens no se pueden leer y el panel pide escribirlos de nuevo.
 */
export const KEY_FILE = path.join(DATA_DIR, 'panel.key');
const PREFIX = 'enc:v1:';

let cachedKey = null;
export function loadKey() {
  if (cachedKey) return cachedKey;
  try {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return (cachedKey = Buffer.from(hex, 'hex'));
    console.error(`  La clave ${KEY_FILE} no tiene el formato esperado; se crea una nueva.`);
  } catch {
    /* no existe todavía */
  }
  cachedKey = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, `${cachedKey.toString('hex')}\n`, { mode: 0o600 });
  return cachedKey;
}

export const isSealed = (value) => typeof value === 'string' && value.startsWith(PREFIX);

/** Cifra un texto (AES-256-GCM). Devuelve "enc:v1:<iv>:<tag>:<datos>" en base64url. */
export function seal(text, key = loadKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const b64 = (b) => b.toString('base64url');
  return `${PREFIX}${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(data)}`;
}

/** Descifra lo que produjo seal(). Lanza si la clave no es la misma o el texto se alteró. */
export function unseal(value, key = loadKey()) {
  if (!isSealed(value)) throw new Error('No es un valor cifrado');
  const [iv, tag, data] = value
    .slice(PREFIX.length)
    .split(':')
    .map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function getAt(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAt(obj, parts, value) {
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] == null || typeof cur[p] !== 'object') return;
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
}

/** Copia del objeto con los campos indicados ("a.b.c") cifrados, para guardarlo en disco. */
export function sealPaths(obj, paths, key = loadKey()) {
  const out = structuredClone(obj);
  for (const p of paths) {
    const parts = p.split('.');
    const v = getAt(out, parts);
    if (typeof v === 'string' && v && !isSealed(v)) setAt(out, parts, seal(v, key));
  }
  return out;
}

/**
 * Descifra en el mismo objeto los campos indicados. Un valor que no se pueda descifrar
 * (clave perdida o archivo alterado) queda vacío y se avisa en la consola.
 */
export function unsealPaths(obj, paths, key = loadKey()) {
  for (const p of paths) {
    const parts = p.split('.');
    const v = getAt(obj, parts);
    if (!isSealed(v)) continue;
    try {
      setAt(obj, parts, unseal(v, key));
    } catch {
      console.error(`  No se pudo descifrar ${p} (¿se perdió ${KEY_FILE}?). Habrá que escribir ese token de nuevo.`);
      setAt(obj, parts, '');
    }
  }
  return obj;
}
