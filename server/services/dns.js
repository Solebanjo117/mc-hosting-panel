import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import { db, getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { USER_AGENT } from '../config.js';
import { rewriteUrl } from '../lib/http.js';
import { HttpError } from '../lib/util.js';
import { publicIp } from './network.js';
import * as playit from './playit.js';

/**
 * Dominio gratis para cada servidor, con el proveedor que elijas:
 *
 *  - DuckDNS:    solo registros A. En Java hay que escribir el puerto si no es 25565 (con playit casi siempre).
 *  - deSEC:      dominio gratis tunombre.dedyn.io con API completa. Crea A + SRV, así Java entra sin puerto.
 *  - Cloudflare: tu propio dominio. Crea A + SRV (sin proxy, que rompe Minecraft).
 *
 * Cada servidor apunta a la IP de tu casa (puertos abiertos) o a su túnel de playit.gg.
 * Bedrock no usa registros SRV: siempre se escribe dirección y puerto por separado.
 */

const API = {
  duckdns: process.env.DUCKDNS_API || 'https://www.duckdns.org',
  desec: process.env.DESEC_API || 'https://desec.io/api/v1',
  cloudflare: process.env.CLOUDFLARE_API || 'https://api.cloudflare.com/client/v4',
};
const CHECK_MS = 5 * 60_000;
const REFRESH_MS = 12 * 60 * 60_000; // re-envía aunque nada cambie, por si alguien editó el registro a mano
const PROVIDERS = ['duckdns', 'desec', 'cloudflare'];
export const PROVIDER_NAMES = { duckdns: 'DuckDNS', desec: 'deSEC', cloudflare: 'Cloudflare' };

// --- Ajustes -------------------------------------------------------------------

function settings() {
  const s = db.data.settings;
  if (!s.dns) {
    s.dns = { provider: null, duckdns: {}, desec: {}, cloudflare: {} };
    migrateDuckDns();
  }
  return s.dns;
}

/** El panel antes solo tenía DuckDNS con la IP de la casa: se pasa al sistema nuevo. */
function migrateDuckDns() {
  const old = db.data.settings.duckdns;
  if (!old?.token) return;
  const dns = db.data.settings.dns;
  dns.duckdns = { token: old.token };
  if (old.enabled) dns.provider = 'duckdns';
  const first = String(old.domains || '').split(',')[0]?.trim();
  if (old.enabled && first) {
    for (const server of db.data.servers) {
      if (!server.dns) server.dns = { enabled: true, name: first, bedrockName: '', target: 'home' };
    }
  }
  delete db.data.settings.duckdns;
  db.flush();
}

const hint = (token) => (token ? `…${token.slice(-4)}` : null);

export function publicStatus() {
  const s = settings();
  return {
    provider: s.provider,
    providerName: PROVIDER_NAMES[s.provider] || null,
    zone: zoneOf(s),
    srv: s.provider === 'desec' || s.provider === 'cloudflare',
    duckdns: { hasToken: Boolean(s.duckdns.token), tokenHint: hint(s.duckdns.token) },
    desec: { hasToken: Boolean(s.desec.token), tokenHint: hint(s.desec.token), domain: s.desec.domain || '' },
    cloudflare: { hasToken: Boolean(s.cloudflare.token), tokenHint: hint(s.cloudflare.token), zone: s.cloudflare.zone || '', zoneId: s.cloudflare.zoneId || '' },
  };
}

function zoneOf(s = settings()) {
  if (s.provider === 'duckdns') return 'duckdns.org';
  if (s.provider === 'desec') return s.desec.domain || null;
  if (s.provider === 'cloudflare') return s.cloudflare.zone || null;
  return null;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function cleanDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

/** Guarda el proveedor y comprueba que el token funcione antes de usarlo. */
export async function saveSettings(body = {}) {
  const s = settings();
  const provider = body.provider === null || body.provider === '' ? null : body.provider;
  if (provider !== null && provider !== undefined && !PROVIDERS.includes(provider)) throw new HttpError(400, 'Proveedor desconocido');
  const next = {
    provider: provider === undefined ? s.provider : provider,
    duckdns: { ...s.duckdns },
    desec: { ...s.desec },
    cloudflare: { ...s.cloudflare },
  };
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  if (next.provider === 'duckdns') {
    if (token) {
      if (!/^[0-9a-f-]{36}$/i.test(token)) throw new HttpError(400, 'El token de DuckDNS tiene el formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      next.duckdns.token = token;
    }
    if (!next.duckdns.token) throw new HttpError(400, 'Falta el token de DuckDNS');
  }
  if (next.provider === 'desec') {
    if (body.domain !== undefined) next.desec.domain = cleanDomain(body.domain);
    if (token) next.desec.token = token;
    if (!DOMAIN_RE.test(next.desec.domain || '')) throw new HttpError(400, 'Escribe tu dominio de deSEC, por ejemplo tunombre.dedyn.io');
    if (!next.desec.token) throw new HttpError(400, 'Falta el token de deSEC');
    const info = await desec.domainInfo(next.desec);
    next.desec.minimumTtl = info.minimum_ttl || 3600;
  }
  if (next.provider === 'cloudflare') {
    if (body.zone !== undefined) next.cloudflare.zone = cleanDomain(body.zone);
    if (body.zoneId !== undefined) next.cloudflare.zoneId = String(body.zoneId || '').trim();
    if (token) next.cloudflare.token = token;
    if (!DOMAIN_RE.test(next.cloudflare.zone || '')) throw new HttpError(400, 'Escribe tu dominio, por ejemplo midominio.com');
    if (!next.cloudflare.token) throw new HttpError(400, 'Falta el token de Cloudflare');
    next.cloudflare.zoneId = await cloudflare.zoneId(next.cloudflare);
  }

  // Si cambias de proveedor o de dominio, se borran los registros viejos (lo que se pueda).
  if (s.provider && (s.provider !== next.provider || zoneOf(s) !== zoneOf(next))) {
    for (const server of db.data.servers) {
      if (server.dns?.applied?.provider === s.provider) {
        await removeRecords(server, s).catch(() => {});
        server.dns.applied = null;
      }
    }
  }
  db.data.settings.dns = next;
  db.flush();
  scheduleSync(1000);
  return publicStatus();
}

/**
 * Desvincula el dominio del panel: borra los registros que creó (deSEC y Cloudflare;
 * DuckDNS no deja borrar), apaga el dominio en todos los servidores y olvida el token.
 */
export async function unlink() {
  const s = settings();
  const errors = [];
  for (const server of db.data.servers) {
    if (!server.dns) continue;
    if (server.dns.applied?.provider === s.provider) {
      await removeRecords(server, s).catch((err) => errors.push(`${server.name}: ${err.message}`));
    }
    server.dns = { ...server.dns, enabled: false, applied: null };
  }
  if (s.provider) s[s.provider] = {};
  s.provider = null;
  db.flush();
  bus.emit('servers');
  return { ...publicStatus(), warnings: errors };
}

// --- Llamadas a cada proveedor -------------------------------------------------

async function request(url, { method = 'GET', headers = {}, body, provider } = {}) {
  let res;
  try {
    res = await fetch(rewriteUrl(url), {
      method,
      headers: { 'User-Agent': USER_AGENT, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new HttpError(502, `No se pudo conectar con ${PROVIDER_NAMES[provider]}: ${err.cause?.code || err.message}`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* DuckDNS responde texto */
  }
  return { res, text, json };
}

const duckdns = {
  async call(cfg, label, extra) {
    const url = `${API.duckdns}/update?domains=${encodeURIComponent(label)}&token=${encodeURIComponent(cfg.token)}&${extra}&verbose=true`;
    const { res, text } = await request(url, { provider: 'duckdns' });
    return res.ok && text.trim().split(/\r?\n/)[0] === 'OK';
  },
  async setA(cfg, label, ip) {
    if (await duckdns.call(cfg, label, `ip=${encodeURIComponent(ip)}`)) return;
    // DuckDNS solo responde "KO", sin decir por qué. Se prueba el mismo token con el registro TXT
    // (no cambia la IP) para saber si el problema es el token o la IP.
    const tokenOk = await duckdns.call(cfg, label, 'txt=mc-hosting-panel').catch(() => false);
    if (tokenOk) {
      throw new HttpError(400, `DuckDNS aceptó tu token pero no la IP ${ip} para "${label}". Intenta "Guardar y actualizar" en unos minutos.`);
    }
    throw new HttpError(
      400,
      `DuckDNS rechazó el token para "${label}". El token guardado en el panel termina en ${cfg.token.slice(-4)}: compáralo con el que aparece arriba en duckdns.org (fila "token") y, si no coincide, pégalo de nuevo en Ajustes del panel.`
    );
  },
};

const desec = {
  headers: (cfg) => ({ Authorization: `Token ${cfg.token}` }),
  explain(res, json, text) {
    if (res.status === 401 || res.status === 403) return 'deSEC no aceptó el token. Crea uno nuevo en desec.io > Token Management.';
    if (res.status === 404) return 'Ese dominio no está en tu cuenta de deSEC. Revisa que esté bien escrito (por ejemplo tunombre.dedyn.io).';
    if (res.status === 429) return 'deSEC pidió esperar un poco (límite de peticiones). El panel lo vuelve a intentar en unos minutos.';
    const detail = json?.detail || (Array.isArray(json) ? json.map((e) => (e && typeof e === 'object' ? Object.values(e).flat().join(' ') : '')).filter(Boolean).join('; ') : '') || text.slice(0, 200);
    return `deSEC respondió ${res.status}: ${detail}`;
  },
  async domainInfo(cfg) {
    const { res, json, text } = await request(`${API.desec}/domains/${encodeURIComponent(cfg.domain)}/`, { headers: desec.headers(cfg), provider: 'desec' });
    if (!res.ok) throw new HttpError(res.status === 401 || res.status === 404 ? 400 : 502, desec.explain(res, json, text));
    return json;
  },
  subname(cfg, host) {
    if (host === cfg.domain) return '';
    return host.slice(0, -(cfg.domain.length + 1));
  },
  /** Crea, cambia o borra (records vacío) varios registros de una vez. */
  async patch(cfg, records) {
    if (!records.length) return;
    const ttl = Math.max(cfg.minimumTtl || 3600, 60);
    const body = records.map((r) => ({
      subname: desec.subname(cfg, r.host),
      type: r.type,
      ttl,
      records: r.delete ? [] : r.type === 'A' ? [r.ip] : [`0 5 ${r.port} ${r.target}.`],
    }));
    const { res, json, text } = await request(`${API.desec}/domains/${encodeURIComponent(cfg.domain)}/rrsets/`, {
      method: 'PATCH',
      headers: desec.headers(cfg),
      body,
      provider: 'desec',
    });
    if (!res.ok) throw new HttpError(502, desec.explain(res, json, text));
  },
};

const cloudflare = {
  headers: (cfg) => ({ Authorization: `Bearer ${cfg.token}` }),
  explain(res, json) {
    const errors = (json?.errors || []).map((e) => `${e.message}${e.code ? ` (${e.code})` : ''}`).join('; ');
    if (res.status === 401 || res.status === 403)
      return `Cloudflare no aceptó el token${errors ? `: ${errors}` : ''}. Crea uno con la plantilla "Edit zone DNS" para tu dominio.`;
    return `Cloudflare respondió ${res.status}${errors ? `: ${errors}` : ''}`;
  },
  async call(cfg, path, opts = {}) {
    const { res, json, text } = await request(`${API.cloudflare}${path}`, { ...opts, headers: cloudflare.headers(cfg), provider: 'cloudflare' });
    if (!res.ok || json?.success === false) throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, cloudflare.explain(res, json, text));
    return json.result;
  },
  async zoneId(cfg) {
    if (cfg.zoneId) {
      const zone = await cloudflare.call(cfg, `/zones/${encodeURIComponent(cfg.zoneId)}`);
      if (zone?.name && zone.name !== cfg.zone) throw new HttpError(400, `Ese Zone ID es de ${zone.name}, no de ${cfg.zone}`);
      return cfg.zoneId;
    }
    const zones = await cloudflare.call(cfg, `/zones?name=${encodeURIComponent(cfg.zone)}`);
    if (!zones?.length)
      throw new HttpError(400, `El token no ve el dominio ${cfg.zone} en Cloudflare. Revisa que el dominio esté en tu cuenta o pega el Zone ID (está en la página del dominio, abajo a la derecha).`);
    return zones[0].id;
  },
  async find(cfg, type, host) {
    return (await cloudflare.call(cfg, `/zones/${cfg.zoneId}/dns_records?type=${type}&name=${encodeURIComponent(host)}`)) || [];
  },
  async upsert(cfg, r) {
    const body =
      r.type === 'A'
        ? { type: 'A', name: r.host, content: r.ip, ttl: 60, proxied: false, comment: 'MC Hosting Panel' }
        : { type: 'SRV', name: r.host, ttl: 60, data: { priority: 0, weight: 5, port: r.port, target: r.target }, comment: 'MC Hosting Panel' };
    const [existing, ...extra] = await cloudflare.find(cfg, r.type, r.host);
    for (const e of extra) await cloudflare.call(cfg, `/zones/${cfg.zoneId}/dns_records/${e.id}`, { method: 'DELETE' });
    if (existing) await cloudflare.call(cfg, `/zones/${cfg.zoneId}/dns_records/${existing.id}`, { method: 'PUT', body });
    else await cloudflare.call(cfg, `/zones/${cfg.zoneId}/dns_records`, { method: 'POST', body });
  },
  async remove(cfg, r) {
    for (const e of await cloudflare.find(cfg, r.type, r.host)) {
      await cloudflare.call(cfg, `/zones/${cfg.zoneId}/dns_records/${e.id}`, { method: 'DELETE' });
    }
  },
};

/** Aplica los registros deseados y borra los que sobraron de la vez anterior. */
async function pushRecords(cfgAll, provider, records, previous = []) {
  const key = (r) => `${r.type} ${r.host}`;
  const wanted = new Set(records.map(key));
  const stale = previous.filter((r) => !wanted.has(key(r)));
  if (provider === 'duckdns') {
    // DuckDNS no deja borrar registros; los que sobran se quedan como estaban.
    for (const r of records) await duckdns.setA(cfgAll.duckdns, r.host.replace(/\.duckdns\.org$/, ''), r.ip);
  } else if (provider === 'desec') {
    await desec.patch(cfgAll.desec, [...records, ...stale.map((r) => ({ ...r, delete: true }))]);
  } else if (provider === 'cloudflare') {
    for (const r of records) await cloudflare.upsert(cfgAll.cloudflare, r);
    for (const r of stale) await cloudflare.remove(cfgAll.cloudflare, r);
  }
}

async function removeRecords(server, cfgAll = settings()) {
  const applied = server.dns?.applied;
  if (!applied?.records?.length || applied.provider === 'duckdns') return;
  if (applied.provider === 'desec') await desec.patch(cfgAll.desec, applied.records.map((r) => ({ ...r, delete: true })));
  if (applied.provider === 'cloudflare') for (const r of applied.records) await cloudflare.remove(cfgAll.cloudflare, r);
}

// --- Destino: IP de la casa o túnel de playit ------------------------------------

function makeResolver() {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const servers = (process.env.MCP_DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map((x) => x.trim()).filter(Boolean);
  try {
    resolver.setServers(servers);
  } catch {
    /* usa los del sistema */
  }
  return resolver;
}

/**
 * Convierte la dirección que muestra playit en IP + puerto reales.
 * Java: "algo.gl.joinmc.link" (el puerto va en un registro SRV) o "host:puerto".
 * Bedrock: "host:puerto" o "1.2.3.4:puerto".
 */
export async function resolveEndpoint(address, kind, resolver = makeResolver()) {
  const text = String(address || '').trim();
  if (!text) throw new HttpError(409, 'El túnel todavía no tiene dirección');
  const m = text.match(/^(.*?)(?::(\d{1,5}))?$/);
  let host = m[1];
  let port = m[2] ? Number(m[2]) : null;
  let target = host;
  if (!port && kind === 'java') {
    try {
      const [srv] = await resolver.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv) {
        target = srv.name.replace(/\.$/, '');
        port = srv.port;
      }
    } catch {
      /* sin SRV: puerto por defecto */
    }
  }
  port ||= kind === 'java' ? 25565 : 19132;
  let ip = net.isIPv4(target) ? target : null;
  if (!ip) {
    try {
      [ip] = await resolver.resolve4(target);
    } catch (err) {
      throw new HttpError(502, `No se pudo averiguar la IP de ${target} (${err.code || err.message})`);
    }
  }
  return { ip, port, target: net.isIPv4(target) ? null : target };
}

/** Qué destino usa el servidor ahora mismo: 'playit' o 'home'. */
function effectiveTarget(server) {
  const t = server.dns?.target || 'auto';
  if (t === 'auto') return server.playit?.enabled && server.playit.javaTunnelId ? 'playit' : 'home';
  return t;
}

async function endpoints(server) {
  const target = effectiveTarget(server);
  const bedrockOn = Boolean(server.bedrock?.enabled);
  if (target === 'home') {
    const ip = await publicIp();
    if (!ip) throw new HttpError(502, 'No se pudo averiguar la IP pública de tu casa');
    return { target, java: { ip, port: Number(server.port) }, bedrock: bedrockOn ? { ip, port: Number(server.bedrock.port) } : null };
  }
  if (!server.playit?.enabled) throw new HttpError(409, 'Este servidor no tiene túnel de playit. Créalo arriba o cambia el destino a "IP de mi casa".');
  const t = await playit.serverTunnels(server.id);
  const resolver = makeResolver();
  const one = async (tunnel, kind, label) => {
    if (!tunnel || tunnel.missing) return null;
    if (!tunnel.address) throw new HttpError(409, `El túnel ${label} todavía no tiene dirección; espera unos segundos`);
    return resolveEndpoint(tunnel.address, kind, resolver);
  };
  const java = await one(t.java, 'java', 'Java');
  if (!java) throw new HttpError(409, 'El servidor no tiene túnel Java en playit');
  const bedrock = bedrockOn ? await one(t.bedrock, 'bedrock', 'Bedrock') : null;
  return { target, java, bedrock, playitJava: t.java?.address || null, playitBedrock: t.bedrock?.address || null };
}

// --- Registros por servidor --------------------------------------------------------

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function cleanName(value, cfg = settings()) {
  let name = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  const zone = zoneOf(cfg);
  if (zone && (name === zone || name.endsWith(`.${zone}`))) name = name.slice(0, -zone.length).replace(/\.$/, '');
  return name;
}

function hostOf(name, cfg = settings()) {
  const zone = zoneOf(cfg);
  return name ? `${name}.${zone}` : zone;
}

/**
 * Registros que debería tener el servidor y lo que deben escribir tus amigos.
 *
 * Con playit hay un detalle: su túnel de Java solo deja pasar al jugador si Minecraft llega con el
 * nombre del túnel (el que va en el "handshake"). Un registro A con tu nombre hacia la IP de playit
 * no sirve (playit corta la conexión). Un registro SRV sí: Minecraft sigue el SRV y se conecta usando
 * el nombre de playit que va dentro, así que funciona. Por eso con playit:
 *  - deSEC / Cloudflare: SRV _minecraft._tcp.<tu nombre> -> nombre de playit + puerto.
 *  - DuckDNS (sin SRV): Java no se puede; solo Bedrock (UDP, no revisa el nombre).
 */
export function plan(server, ep, cfg = settings()) {
  const conf = server.dns;
  const records = [];
  const warnings = [];
  const srv = cfg.provider !== 'duckdns';
  const viaPlayit = ep.target === 'playit';
  const javaHost = hostOf(conf.name, cfg);
  let java;

  if (viaPlayit) {
    if (srv) {
      if (!ep.java.target) throw new HttpError(409, 'No se pudo leer el nombre del túnel Java de playit');
      records.push({ type: 'SRV', host: `_minecraft._tcp.${javaHost}`, port: ep.java.port, target: ep.java.target });
      java = { address: javaHost, withPort: false };
    } else {
      java = { unsupported: true, playitAddress: ep.playitJava };
      if (!ep.bedrock) {
        throw new HttpError(
          409,
          'Con el túnel de playit, Java no funciona con DuckDNS: playit solo acepta su propia dirección (DuckDNS no tiene registros SRV). Usa Cloudflare o deSEC con tu dominio, o comparte la dirección de playit.'
        );
      }
    }
  } else {
    records.push({ type: 'A', host: javaHost, ip: ep.java.ip });
    java = { address: ep.java.port === 25565 ? javaHost : `${javaHost}:${ep.java.port}`, withPort: ep.java.port !== 25565 };
    if (srv && ep.java.port !== 25565) {
      // Minecraft Java busca _minecraft._tcp.<nombre> y así tus amigos no escriben el puerto.
      records.push({ type: 'SRV', host: `_minecraft._tcp.${javaHost}`, port: ep.java.port, target: javaHost });
      java = { address: javaHost, withPort: false };
    }
  }

  let bedrock = null;
  if (ep.bedrock) {
    let bedrockHost;
    if (cfg.provider === 'duckdns') {
      bedrockHost = conf.bedrockName ? hostOf(conf.bedrockName, cfg) : javaHost;
      if (!viaPlayit && bedrockHost === javaHost && ep.bedrock.ip !== ep.java.ip) {
        bedrockHost = null;
        warnings.push('Bedrock usa otra IP que Java. Crea un segundo subdominio en duckdns.org y escríbelo en "Subdominio para Bedrock".');
      }
    } else if (viaPlayit) {
      // Con playit el nombre no tiene registro A para Java (usa SRV), así que Bedrock puede usarlo.
      bedrockHost = javaHost;
    } else {
      bedrockHost = ep.bedrock.ip === ep.java.ip ? javaHost : hostOf(conf.name ? `be.${conf.name}` : 'be', cfg);
    }
    if (bedrockHost) {
      if (!records.some((r) => r.type === 'A' && r.host === bedrockHost)) records.push({ type: 'A', host: bedrockHost, ip: ep.bedrock.ip });
      bedrock = { host: bedrockHost, port: ep.bedrock.port };
    }
  }
  return { records, java, bedrock, warnings };
}

let syncing = Promise.resolve();

/** Calcula y aplica los registros del servidor. force: envía aunque no haya cambios. */
export async function syncServer(id, { force = false } = {}) {
  const run = async () => {
    const server = getServer(id);
    const cfg = settings();
    if (!server?.dns?.enabled || !cfg.provider) return null;
    const applied = server.dns.applied || {};
    const now = new Date().toISOString();
    try {
      const ep = await endpoints(server);
      const p = plan(server, ep, cfg);
      const fingerprint = JSON.stringify([cfg.provider, zoneOf(cfg), p.records]);
      const fresh = applied.ok && applied.fingerprint === fingerprint && Date.now() - Date.parse(applied.at || 0) < REFRESH_MS;
      if (!force && fresh) return server.dns.applied;
      const previous = applied.provider === cfg.provider ? applied.records || [] : [];
      await pushRecords(cfg, cfg.provider, p.records, previous);
      server.dns.applied = {
        ok: true,
        at: now,
        provider: cfg.provider,
        fingerprint,
        records: p.records,
        target: ep.target,
        java: p.java,
        bedrock: p.bedrock,
        warnings: p.warnings,
        error: null,
      };
    } catch (err) {
      server.dns.applied = { ...applied, ok: false, at: now, error: err.message };
    }
    db.flush();
    bus.emit('servers');
    return server.dns.applied;
  };
  syncing = syncing.then(run, run);
  return syncing;
}

export async function syncAll({ force = false } = {}) {
  for (const server of db.data.servers) {
    if (server.dns?.enabled) await syncServer(server.id, { force }).catch(() => {});
  }
}

let timer = null;
/** Revisa pronto (por ejemplo después de crear un túnel o cambiar un puerto). */
export function scheduleSync(delay = 8000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncAll().catch(() => {}), delay);
  timer.unref?.();
}

export function serverStatus(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const cfg = settings();
  const conf = server.dns || { enabled: false, name: '', bedrockName: '', target: 'auto' };
  return {
    provider: cfg.provider,
    providerName: PROVIDER_NAMES[cfg.provider] || null,
    zone: zoneOf(cfg),
    srv: cfg.provider === 'desec' || cfg.provider === 'cloudflare',
    enabled: Boolean(conf.enabled),
    name: conf.name || '',
    bedrockName: conf.bedrockName || '',
    target: conf.target || 'auto',
    effectiveTarget: effectiveTarget(server),
    applied: conf.applied || null,
  };
}

export async function configureServer(id, body = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const cfg = settings();
  if (!cfg.provider) throw new HttpError(409, 'Primero elige un servicio de dominio en Ajustes del panel');
  const conf = { ...(server.dns || { enabled: false, name: '', bedrockName: '', target: 'auto' }) };

  if (body.target !== undefined) {
    if (!['auto', 'home', 'playit'].includes(body.target)) throw new HttpError(400, 'Destino inválido');
    conf.target = body.target;
  }
  if (body.name !== undefined) conf.name = cleanName(body.name, cfg);
  if (body.bedrockName !== undefined) conf.bedrockName = cleanName(body.bedrockName, cfg);
  if (body.enabled !== undefined) conf.enabled = Boolean(body.enabled);

  const checkName = (name, label, required) => {
    if (!name) {
      if (required) throw new HttpError(400, `Escribe el ${label}`);
      return;
    }
    const parts = name.split('.');
    if (cfg.provider === 'duckdns' && parts.length > 1) throw new HttpError(400, `En DuckDNS el ${label} es una sola palabra, sin puntos`);
    if (parts.some((p) => !LABEL_RE.test(p))) throw new HttpError(400, `El ${label} solo puede tener letras, números y guiones`);
  };
  checkName(conf.name, 'subdominio', cfg.provider === 'duckdns');
  if (cfg.provider === 'duckdns') checkName(conf.bedrockName, 'subdominio para Bedrock', false);
  else conf.bedrockName = '';

  // Dos servidores no pueden usar el mismo nombre (salvo en DuckDNS si ambos apuntan a la IP de la casa).
  if (conf.enabled) {
    const host = hostOf(conf.name, cfg);
    for (const other of db.data.servers) {
      if (other.id === id || !other.dns?.enabled) continue;
      if (hostOf(other.dns.name, cfg) !== host) continue;
      const bothHome = cfg.provider === 'duckdns' && conf.target === 'home' && other.dns.target === 'home';
      if (!bothHome) throw new HttpError(409, `${host} ya lo usa el servidor ${other.name}`);
    }
  }

  const wasEnabled = server.dns?.enabled;
  if (wasEnabled && !conf.enabled) {
    await removeRecords(server, cfg).catch(() => {});
    conf.applied = null;
  }
  server.dns = conf;
  db.flush();
  if (conf.enabled) await syncServer(id, { force: true });
  return serverStatus(id);
}

/** Al borrar un servidor se quitan sus registros. */
export async function forgetServer(id) {
  const server = getServer(id);
  if (server?.dns?.enabled) await removeRecords(server).catch(() => {});
}

// Cuando cambia un túnel de playit, los registros se actualizan solos.
bus.on('tunnels', () => scheduleSync());

// Revisión periódica: la IP de la casa o la dirección del túnel pueden cambiar.
setInterval(() => syncAll().catch(() => {}), CHECK_MS).unref();
setTimeout(() => {
  settings();
  syncAll().catch(() => {});
}, 10_000).unref();
