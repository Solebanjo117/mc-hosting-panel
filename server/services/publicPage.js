import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { instance } from './processManager.js';
import { readProperties } from './properties.js';
import { publicIp } from './network.js';
import * as dns from './dns.js';
import * as playit from './playit.js';

/**
 * Página pública de cada servidor: estado, quién juega, MOTD y cómo entrar.
 * Se activa por servidor y se ve sin sesión en /estado/<id>. Solo sale lo que el
 * administrador decide mostrar; nunca la consola, los archivos ni la IP local.
 */

export function publicSettings(server) {
  return { enabled: false, showPlayers: true, showAddress: true, message: '', ...(server.public || {}) };
}

export function setPublicSettings(id, body = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const cur = publicSettings(server);
  server.public = {
    enabled: body.enabled === undefined ? cur.enabled : Boolean(body.enabled),
    showPlayers: body.showPlayers === undefined ? cur.showPlayers : Boolean(body.showPlayers),
    showAddress: body.showAddress === undefined ? cur.showAddress : Boolean(body.showAddress),
    message: body.message === undefined ? cur.message : String(body.message).trim().slice(0, 200),
  };
  db.save();
  return server.public;
}

/** La mejor dirección para entrar desde fuera: dominio, túnel de playit o IP pública con puerto. */
export async function publicAddress(server) {
  const out = { java: null, bedrock: null, via: null };
  try {
    const d = dns.serverStatus(server.id);
    if (d.enabled && d.applied?.ok) {
      if (d.applied.java && !d.applied.java.unsupported) out.java = d.applied.java.address;
      if (d.applied.bedrock) out.bedrock = { host: d.applied.bedrock.host, port: d.applied.bedrock.port };
      out.via = 'dominio';
    }
  } catch {
    /* sin dominio */
  }
  if (!out.java && server.playit?.enabled) {
    try {
      const t = await playit.serverTunnels(server.id);
      if (t.java?.address) out.java = t.java.address;
      if (t.bedrock?.address) {
        const [host, port] = t.bedrock.address.split(':');
        out.bedrock = out.bedrock || { host, port: Number(port) };
      }
      if (out.java) out.via = out.via || 'playit';
    } catch {
      /* el agente no responde */
    }
  }
  if (!out.java) {
    const ip = await publicIp();
    if (ip) {
      out.java = `${ip}:${server.port}`;
      if (server.bedrock?.enabled && !out.bedrock) out.bedrock = { host: ip, port: server.bedrock.port };
      out.via = out.via || 'ip';
    }
  }
  return out;
}

export async function publicStatus(id) {
  const server = getServer(id);
  if (!server || !publicSettings(server).enabled) throw new HttpError(404, 'Esta página no está disponible');
  const cfg = publicSettings(server);
  const inst = instance(id);
  const props = readProperties(id);
  const status = server.installState !== 'ready' ? 'stopped' : inst.status;
  return {
    id: server.id,
    name: server.name,
    motd: props.motd || 'A Minecraft Server',
    icon: fs.existsSync(path.join(serverDir(id), 'server-icon.png')) ? server.iconAt || 1 : 0,
    type: server.type,
    mcVersion: server.mcVersion,
    maxPlayers: Number(props['max-players']) || 20,
    status,
    players: cfg.showPlayers ? [...inst.players] : null,
    playerCount: inst.players.size,
    startedAt: inst.startedAt,
    bedrock: Boolean(server.bedrock?.enabled),
    modpack: server.modpack ? { name: server.modpack.name, source: server.modpack.source || null } : null,
    message: cfg.message,
    address: cfg.showAddress ? await publicAddress(server) : null,
    maintenance: server.maintenance?.active ? { message: server.maintenance.message, until: server.maintenance.until || null } : null,
  };
}
