import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA_DIR, IS_WINDOWS, VERSION } from '../config.js';
import { db, getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { download } from '../lib/http.js';
import { HttpError, sleep } from '../lib/util.js';

/**
 * Túneles de playit.gg: permiten que tus amigos entren aunque tu internet tenga CGNAT.
 *
 * Desde playit 1.0 el programa de Windows (playitd) solo mantiene los túneles abiertos.
 * El panel hace lo demás con la API de playit:
 *  1. Vincula el agente a la cuenta del usuario (claim) como "self-managed".
 *  2. Crea un túnel Minecraft Java (TCP) y, si hay Bedrock, uno Minecraft Bedrock (UDP) por servidor.
 *  3. Lee la dirección pública de cada túnel para mostrarla.
 */

const API = process.env.PLAYIT_API || 'https://api.playit.gg';
const AGENT_VERSION = 'v1.0.12';
const DIR = path.join(DATA_DIR, 'playit');
const SECRET_FILE = path.join(DIR, 'playit.toml');
const BIN = path.join(DIR, IS_WINDOWS ? 'playitd.exe' : 'playitd');
const ASSET = IS_WINDOWS ? 'playit-windows-x86_64-signed.exe' : process.arch === 'arm64' ? 'playit-linux-aarch64' : 'playit-linux-amd64';
fs.mkdirSync(DIR, { recursive: true });

const ERRORS = {
  AccountPortLimitReached: 'Llegaste al límite de túneles del plan gratuito de playit. Borra túneles que no uses en playit.gg o activa Premium.',
  RequiresVerifiedAccount: 'Verifica tu correo en playit.gg para poder crear túneles.',
  RequiresPlayitPremium: 'Esa opción requiere playit Premium.',
  RegionRequiresPlayitPremium: 'Elegir región requiere playit Premium.',
  AgentNotSelfManaged: 'Este agente no se vinculó desde el panel. Desvincúlalo y vuelve a vincularlo.',
  AgentVersionTooOld: 'El agente de playit es muy viejo; usa "Reinstalar agente".',
  TunnelNotFound: 'El túnel ya no existe en playit.gg.',
  CodeExpired: 'El enlace de vinculación caducó. Vuelve a intentarlo.',
  InvalidCode: 'Código de vinculación inválido.',
  UserRejected: 'Rechazaste la vinculación en playit.gg.',
  TunnelNameIsNotAscii: 'El nombre del túnel no es válido.',
};

const state = {
  proc: null,
  status: 'stopped', // stopped | starting | running | connected | error
  logs: [],
  claim: null, // { code, url, state }
  restarts: 0,
  agentId: null,
};

function settings() {
  if (!db.data.settings.playit) db.data.settings.playit = { enabled: false };
  return db.data.settings.playit;
}

function readSecret() {
  try {
    const text = fs.readFileSync(SECRET_FILE, 'utf8');
    const m = text.match(/secret_key\s*=\s*"([0-9a-fA-F]+)"/) || text.match(/^\s*([0-9a-fA-F]{32,})\s*$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function log(line) {
  const clean = String(line).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!clean) return;
  state.logs.push(`${new Date().toTimeString().slice(0, 8)} ${clean}`);
  if (state.logs.length > 300) state.logs.splice(0, state.logs.length - 300);
  if (/playit connected/.test(clean)) setStatus('connected');
}

function setStatus(s) {
  state.status = s;
  bus.emit('playit', status());
}

export function status() {
  return {
    installed: fs.existsSync(BIN),
    claimed: Boolean(readSecret()),
    enabled: Boolean(settings().enabled),
    status: state.status,
    claim: state.claim,
    agentId: state.agentId,
    logs: state.logs.slice(-80),
    version: AGENT_VERSION,
  };
}

// --- API ---------------------------------------------------------------------

const AUTH_ERRORS = {
  InvalidAgentKey: 'La llave del agente de playit ya no es válida. Desvincula playit en Ajustes del panel y vuelve a vincularlo.',
  NoLongerValid: 'La vinculación con playit ya no es válida. Desvincula playit en Ajustes del panel y vuelve a vincularlo.',
  AgentNotSelfManaged: ERRORS.AgentNotSelfManaged,
  SelfManagedAgentCanOnlyAffectSelf: 'playit no dejó que el panel cambie ese túnel. Créalo en playit.gg asignado al agente del panel y vincúlalo aquí.',
  EmailMustBeVerified: ERRORS.RequiresVerifiedAccount,
  GuestAccountNotAllowed: 'Las cuentas de invitado de playit no pueden crear túneles. Crea tu cuenta con correo en playit.gg.',
  AccountNotAuthorized: 'Tu cuenta de playit no tiene permiso para esto.',
  AccountDoesNotExist: 'La cuenta de playit vinculada ya no existe. Vuelve a vincular playit.',
  DefaultAgentBlocked: 'playit bloqueó este agente. Revisa tu cuenta en playit.gg.',
};

/** Convierte la respuesta de error de playit en un mensaje claro en español. */
function describeError(json, httpStatus) {
  const data = json?.data;
  if (json?.status === 'error' && data && typeof data === 'object' && data.type) {
    // ApiResponseError: { type: validation | path-not-found | auth | internal, message }
    if (data.type === 'auth') return [409, AUTH_ERRORS[data.message] || `playit.gg rechazó la llave del panel (${data.message})`];
    if (data.type === 'validation') return [400, `playit.gg no aceptó la petición: ${data.message}`];
    if (data.type === 'path-not-found') return [502, 'playit.gg cambió su API. Crea el túnel en playit.gg y usa "Usar un túnel que ya creé".'];
    if (data.type === 'internal') return [502, `playit.gg tuvo un error interno${data.message?.trace_id ? ` (código ${data.message.trace_id})` : ''}. Intenta en unos minutos.`];
    return [502, `playit.gg: ${data.type} ${typeof data.message === 'string' ? data.message : JSON.stringify(data.message ?? '')}`.trim()];
  }
  const code = typeof data === 'string' ? data : data?.error || data?.type || JSON.stringify(data ?? `HTTP ${httpStatus}`);
  return [json?.status === 'fail' ? 400 : 502, ERRORS[code] || `playit.gg: ${code}`];
}

async function call(apiPath, body = {}, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': `mc-hosting-panel/${VERSION}` };
  if (auth) {
    const secret = readSecret();
    if (!secret) throw new HttpError(409, 'Primero vincula playit.gg con tu cuenta');
    headers.Authorization = `Agent-Key ${secret}`;
  }
  let res;
  try {
    res = await fetch(`${API}${apiPath}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new HttpError(502, `No se pudo conectar con playit.gg: ${err.cause?.code || err.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(502, `playit.gg respondió ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  if (json.status === 'success') return json.data;
  const [status, message] = describeError(json, res.status);
  log(`API ${apiPath}: ${message} [${text.slice(0, 300)}]`);
  throw new HttpError(status, message);
}

// --- Agente --------------------------------------------------------------------

export async function installAgent() {
  const url = `https://github.com/playit-cloud/playit-agent/releases/download/${AGENT_VERSION}/${ASSET}`;
  const tmp = `${BIN}.download`;
  try {
    await download(url, tmp);
  } catch {
    await download(`https://github.com/playit-cloud/playit-agent/releases/latest/download/${ASSET}`, tmp);
  }
  if (state.proc) await stopAgent();
  fs.renameSync(tmp, BIN);
  if (!IS_WINDOWS) fs.chmodSync(BIN, 0o755);
  log(`Agente de playit ${AGENT_VERSION} instalado.`);
  return status();
}

export async function startAgent() {
  if (state.proc) return status();
  if (!readSecret()) throw new HttpError(409, 'Primero vincula playit.gg con tu cuenta');
  if (!fs.existsSync(BIN)) await installAgent();
  setStatus('starting');
  const proc = spawn(BIN, ['--secret-path', SECRET_FILE], { cwd: DIR, windowsHide: true, env: { ...process.env, PLAYIT_LOG: 'info' } });
  state.proc = proc;
  let partial = '';
  const onData = (d) => {
    const parts = (partial + d.toString()).split(/\r?\n/);
    partial = parts.pop();
    parts.forEach(log);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (err) => log(`No se pudo iniciar el agente: ${err.message}`));
  proc.on('exit', (code) => {
    state.proc = null;
    log(`El agente se cerró (código ${code}).`);
    if (settings().enabled && !state.stopping && state.restarts < 5) {
      state.restarts += 1;
      setStatus('starting');
      setTimeout(() => startAgent().catch((e) => log(e.message)), 5000 * state.restarts);
    } else {
      setStatus(state.stopping ? 'stopped' : 'error');
    }
    state.stopping = false;
  });
  setTimeout(() => {
    if (state.proc === proc && state.status === 'starting') setStatus('running');
  }, 4000);
  setTimeout(() => {
    if (state.proc === proc) state.restarts = 0;
  }, 60_000);
  return status();
}

export async function stopAgent() {
  const proc = state.proc;
  if (!proc) return status();
  state.stopping = true;
  proc.kill();
  await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]);
  if (state.proc === proc) proc.kill('SIGKILL');
  setStatus('stopped');
  return status();
}

export async function setEnabled(enabled) {
  settings().enabled = Boolean(enabled);
  db.flush();
  if (enabled) return startAgent();
  return stopAgent();
}

// --- Vinculación (claim) -------------------------------------------------------

/**
 * Genera un código, devuelve el enlace para que el usuario lo abra y espera
 * en segundo plano a que acepte en playit.gg.
 */
export function startClaim() {
  if (state.claim && ['waiting', 'visited'].includes(state.claim.state)) return status();
  const code = crypto.randomBytes(5).toString('hex');
  state.claim = { code, url: `https://playit.gg/claim/${code}`, state: 'waiting', error: null };
  bus.emit('playit', status());

  (async () => {
    const deadline = Date.now() + 15 * 60_000;
    try {
      while (Date.now() < deadline && state.claim?.code === code) {
        const r = await call('/claim/setup', { code, agent_type: 'self-managed', version: `mc-hosting-panel ${VERSION}` }, { auth: false });
        if (r === 'UserAccepted') break;
        if (r === 'UserRejected') throw new HttpError(400, ERRORS.UserRejected);
        if (r === 'WaitingForUser' && state.claim.state !== 'visited') {
          state.claim.state = 'visited';
          bus.emit('playit', status());
        }
        await sleep(1500);
      }
      if (state.claim?.code !== code) return;
      if (Date.now() >= deadline) throw new HttpError(408, 'Se acabó el tiempo para vincular. Vuelve a intentarlo.');
      const { secret_key: secret } = await call('/claim/exchange', { code }, { auth: false });
      fs.writeFileSync(SECRET_FILE, `secret_key = "${secret}"\n`, { mode: 0o600 });
      state.claim = { ...state.claim, state: 'done' };
      settings().enabled = true;
      db.flush();
      await startAgent();
      await agentId(true);
    } catch (err) {
      if (state.claim?.code === code) state.claim = { ...state.claim, state: 'error', error: err.message };
    }
    bus.emit('playit', status());
  })();
  return status();
}

export async function unlink() {
  await stopAgent();
  fs.rmSync(SECRET_FILE, { force: true });
  state.claim = null;
  state.agentId = null;
  settings().enabled = false;
  for (const s of db.data.servers) if (s.playit) s.playit = { enabled: false };
  db.flush();
  bus.emit('servers');
  return status();
}

async function agentId(refresh = false) {
  if (state.agentId && !refresh) return state.agentId;
  const data = await call('/v1/agents/rundata');
  state.agentId = data.agent_id;
  return state.agentId;
}

// --- Túneles por servidor ------------------------------------------------------

function asciiName(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .slice(0, 40) || 'Minecraft';
}

async function createTunnel(server, kind, port) {
  const body = {
    ports: { type: 'tunnel-type', details: kind === 'java' ? 'minecraft-java' : 'minecraft-bedrock' },
    origin: {
      type: 'agent',
      data: {
        agent_id: await agentId(),
        config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: String(port) }] },
      },
    },
    enabled: true,
    alloc: null,
    name: asciiName(`${server.name} ${kind === 'java' ? 'Java' : 'Bedrock'}`),
    firewall_id: null,
  };
  try {
    const { id } = await call('/v1/tunnels/create', body);
    return id;
  } catch (err) {
    err.message = `No se pudo crear el túnel ${kind === 'java' ? 'Java' : 'Bedrock'}: ${err.message}`;
    throw err;
  }
}

async function deleteTunnel(id) {
  try {
    await call('/tunnels/delete', { tunnel_id: id });
  } catch (err) {
    if (!/ya no existe/.test(err.message)) throw err;
  }
}

async function setLocalPort(tunnelId, port) {
  await call('/v1/tunnels/config', {
    tunnel_id: tunnelId,
    new_agent_id: null,
    new_config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: String(port) }] },
  });
}

/** Túneles de este agente, con su dirección pública. */
export async function listTunnels() {
  const data = await call('/v1/agents/rundata');
  state.agentId = data.agent_id;
  const map = new Map();
  for (const t of data.tunnels || []) {
    const port = t.agent_config?.fields?.find((f) => f.name === 'local_port')?.value;
    map.set(t.id, {
      id: t.id,
      name: t.name,
      address: t.display_address,
      type: t.tunnel_type,
      typeLabel: t.tunnel_type_display || t.tunnel_type || null,
      portType: t.port_type ? String(t.port_type).toLowerCase() : null,
      localPort: port ? Number(port) : null,
      disabled: t.disabled_reason || null,
      pending: false,
    });
  }
  for (const t of data.pending || []) {
    map.set(t.id, {
      id: t.id,
      name: t.name,
      address: null,
      type: t.tunnel_type,
      typeLabel: t.tunnel_type_display || t.tunnel_type || null,
      portType: t.port_type ? String(t.port_type).toLowerCase() : null,
      pending: true,
      status: t.status_msg,
    });
  }
  return { tunnels: map, notices: (data.notices || []).map((n) => ({ message: n.message, link: n.resolve_link })) };
}

export async function serverTunnels(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const base = { ...status(), logs: undefined, serverEnabled: Boolean(server.playit?.enabled) };
  if (!server.playit?.enabled || !readSecret()) return { ...base, java: null, bedrock: null, notices: [] };
  const { tunnels, notices } = await listTunnels();
  return {
    ...base,
    java: server.playit.javaTunnelId ? tunnels.get(server.playit.javaTunnelId) || { missing: true } : null,
    bedrock: server.playit.bedrockTunnelId ? tunnels.get(server.playit.bedrockTunnelId) || { missing: true } : null,
    notices,
  };
}

/** ¿Sirve este túnel para Java (TCP) o para Bedrock (UDP)? */
function fits(tunnel, kind) {
  if (tunnel.type === 'minecraft-java') return kind === 'java';
  if (tunnel.type === 'minecraft-bedrock') return kind === 'bedrock';
  if (!tunnel.type && tunnel.portType) return tunnel.portType === 'both' || tunnel.portType === (kind === 'java' ? 'tcp' : 'udp');
  return false;
}

/** Túneles que ya usa otro servidor del panel. */
function usedElsewhere(serverId) {
  const used = new Map();
  for (const s of db.data.servers) {
    if (s.id === serverId || !s.playit?.enabled) continue;
    for (const key of ['javaTunnelId', 'bedrockTunnelId']) if (s.playit[key]) used.set(s.playit[key], s.name);
  }
  return used;
}

/** Los túneles creados por el panel se borran al quitarlos; los que vinculaste tú solo se desvinculan. */
const owns = (p, kind) => p?.owned?.[kind] !== false;

/**
 * Crea (o repara) los túneles del servidor según sus puertos actuales.
 * Si en playit.gg ya hay un túnel libre del mismo tipo que apunta al puerto del servidor, lo usa en vez de crear otro.
 */
export async function enableForServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  if (!readSecret()) throw new HttpError(409, 'Primero vincula playit.gg en Ajustes del panel');
  if (!state.proc) await startAgent();
  const { tunnels } = await listTunnels();
  const used = usedElsewhere(id);
  const p = {
    enabled: true,
    javaTunnelId: server.playit?.javaTunnelId || null,
    bedrockTunnelId: server.playit?.bedrockTunnelId || null,
    owned: { java: owns(server.playit, 'java'), bedrock: owns(server.playit, 'bedrock') },
  };

  const ensure = async (kind, key, port) => {
    const existing = p[key] && tunnels.get(p[key]);
    if (existing) {
      if (existing.localPort && existing.localPort !== Number(port)) await setLocalPort(p[key], port);
      return;
    }
    const match = [...tunnels.values()].find((t) => !used.has(t.id) && fits(t, kind) && t.localPort === Number(port));
    if (match) {
      p[key] = match.id;
      p.owned[kind] = false;
      log(`Se usará el túnel "${match.name}" que ya existía en playit.gg para ${server.name}.`);
    } else {
      p[key] = await createTunnel(server, kind, port);
      p.owned[kind] = true;
    }
  };
  const warnings = [];
  await ensure('java', 'javaTunnelId', server.port);
  if (server.bedrock?.enabled) {
    // Si falla el de Bedrock, el de Java se queda funcionando.
    try {
      await ensure('bedrock', 'bedrockTunnelId', server.bedrock.port);
    } catch (err) {
      p.bedrockTunnelId = null;
      warnings.push(err.message);
    }
  } else if (p.bedrockTunnelId) {
    if (p.owned.bedrock) await deleteTunnel(p.bedrockTunnelId);
    p.bedrockTunnelId = null;
  }
  server.playit = p;
  db.flush();
  return { ...(await serverTunnels(id)), warnings };
}

/**
 * Vincula al servidor túneles que el usuario creó a mano en playit.gg.
 * Si el túnel apunta a otro puerto, intenta ajustarlo; si playit no lo permite, avisa.
 */
export async function linkTunnels(id, { java, bedrock } = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  if (!readSecret()) throw new HttpError(409, 'Primero vincula playit.gg en Ajustes del panel');
  if (!java && !bedrock) throw new HttpError(400, 'Elige al menos un túnel');
  if (bedrock && !server.bedrock?.enabled) throw new HttpError(400, 'Este servidor no tiene Bedrock activado');
  const { tunnels } = await listTunnels();
  const used = usedElsewhere(id);
  const warnings = [];
  const p = {
    enabled: true,
    javaTunnelId: server.playit?.javaTunnelId || null,
    bedrockTunnelId: server.playit?.bedrockTunnelId || null,
    owned: { java: owns(server.playit, 'java'), bedrock: owns(server.playit, 'bedrock') },
  };

  const pick = async (kind, tunnelId, port) => {
    if (!tunnelId) return;
    const t = tunnels.get(tunnelId);
    const label = kind === 'java' ? 'Java' : 'Bedrock';
    if (!t) throw new HttpError(404, `El túnel ${label} no está asignado al agente del panel. En playit.gg, en "Assign to Agent", elige el agente del panel.`);
    if (used.has(t.id)) throw new HttpError(409, `El túnel "${t.name}" ya lo usa el servidor ${used.get(t.id)}`);
    if ((t.type || t.portType) && !fits(t, kind)) throw new HttpError(400, `"${t.name}" no es un túnel ${kind === 'java' ? 'Minecraft Java (TCP)' : 'Minecraft Bedrock (UDP)'}`);
    const key = kind === 'java' ? 'javaTunnelId' : 'bedrockTunnelId';
    if (p[key] && p[key] !== t.id && p.owned[kind]) await deleteTunnel(p[key]).catch(() => {});
    p[key] = t.id;
    p.owned[kind] = false;
    if (t.localPort && t.localPort !== Number(port)) {
      try {
        await setLocalPort(t.id, port);
      } catch {
        warnings.push(`El túnel "${t.name}" apunta al puerto ${t.localPort}, pero el servidor usa el ${port}. Cámbialo en playit.gg (Local Address: 127.0.0.1, puerto ${port}).`);
      }
    }
  };
  await pick('java', java, server.port);
  await pick('bedrock', bedrock, server.bedrock?.port);
  server.playit = p;
  db.flush();
  if (!state.proc) await startAgent().catch((err) => warnings.push(err.message));
  return { ...(await serverTunnels(id)), warnings };
}

/** Lista los túneles del agente con qué servidor del panel usa cada uno. */
export async function agentTunnels() {
  const { tunnels, notices } = await listTunnels();
  const usedBy = usedElsewhere(null);
  return { agentId: state.agentId, tunnels: [...tunnels.values()].map((t) => ({ ...t, usedBy: usedBy.get(t.id) || null })), notices };
}

export async function disableForServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const kinds = { javaTunnelId: 'java', bedrockTunnelId: 'bedrock' };
  for (const [key, kind] of Object.entries(kinds)) {
    if (server.playit?.[key] && owns(server.playit, kind)) await deleteTunnel(server.playit[key]);
  }
  server.playit = { enabled: false };
  db.flush();
}

/** Al cambiar puertos o activar Bedrock, los túneles se ajustan solos. */
export function syncServer(id) {
  const server = getServer(id);
  if (server?.playit?.enabled && readSecret()) {
    enableForServer(id).catch((err) => log(`No se pudieron actualizar los túneles de ${server.name}: ${err.message}`));
  }
}

export function autoStart() {
  if (settings().enabled && readSecret()) startAgent().catch((err) => log(err.message));
}
