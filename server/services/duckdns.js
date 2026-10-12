import { db } from '../db.js';
import { getText } from '../lib/http.js';
import { HttpError } from '../lib/util.js';

/**
 * Mantiene actualizado un subdominio gratuito de DuckDNS (tunombre.duckdns.org)
 * con la IP pública de esta casa, para no depender de que la IP no cambie.
 */

const INTERVAL_MS = 5 * 60_000;

function settings() {
  if (!db.data.settings.duckdns) db.data.settings.duckdns = { enabled: false, domains: '', token: '' };
  return db.data.settings.duckdns;
}

export function cleanDomains(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/\.duckdns\.org$/, ''))
    .filter(Boolean);
}

export function publicStatus() {
  const s = settings();
  const domains = cleanDomains(s.domains);
  return {
    enabled: Boolean(s.enabled),
    domains,
    hosts: domains.map((d) => `${d}.duckdns.org`),
    hasToken: Boolean(s.token),
    tokenHint: s.token ? `…${s.token.slice(-4)}` : null,
    lastUpdate: s.lastUpdate || null,
    lastResult: s.lastResult || null,
    lastIp: s.lastIp || null,
  };
}

export async function updateNow() {
  const s = settings();
  const domains = cleanDomains(s.domains);
  if (!domains.length || !s.token) throw new HttpError(400, 'Falta el subdominio o el token de DuckDNS');
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(domains.join(','))}&token=${encodeURIComponent(s.token)}&ip=&verbose=true`;
  let ok = false;
  let ip = null;
  try {
    const text = (await getText(url, { timeout: 15000 })).trim().split(/\r?\n/);
    ok = text[0] === 'OK';
    ip = text[1] || null;
    s.lastResult = ok ? (text[3] === 'UPDATED' ? 'Actualizado' : 'Sin cambios') : 'DuckDNS rechazó el subdominio o el token';
  } catch (err) {
    s.lastResult = `Error: ${err.message}`;
  }
  s.lastUpdate = new Date().toISOString();
  if (ip) s.lastIp = ip;
  db.save();
  return publicStatus();
}

export async function saveSettings({ enabled, domains, token }) {
  const s = settings();
  if (domains !== undefined) {
    const list = cleanDomains(domains);
    if (list.some((d) => !/^[a-z0-9-]{1,63}$/.test(d))) throw new HttpError(400, 'Subdominio inválido: usa solo letras, números y guiones');
    s.domains = list.join(',');
  }
  // El token solo se cambia si se manda uno nuevo; la interfaz nunca recibe el token completo.
  if (token) {
    if (!/^[0-9a-f-]{36}$/i.test(token.trim())) throw new HttpError(400, 'El token de DuckDNS tiene el formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    s.token = token.trim();
  }
  if (enabled !== undefined) s.enabled = Boolean(enabled);
  db.flush();
  if (s.enabled) return updateNow();
  return publicStatus();
}

setInterval(() => {
  if (settings().enabled) updateNow().catch(() => {});
}, INTERVAL_MS).unref();

// Primera actualización poco después de abrir el panel.
setTimeout(() => {
  if (settings().enabled) updateNow().catch(() => {});
}, 10_000).unref();
