import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { getJson } from '../lib/http.js';

/** Qué firewall hay en esta máquina: para enseñar el comando correcto en Conexión. */
export function firewallKind() {
  if (process.platform === 'win32') return 'windows';
  const dirs = (process.env.PATH || '').split(':');
  const has = (bin) => dirs.some((d) => fs.existsSync(path.join(d, bin)));
  if (has('firewall-cmd')) return 'firewalld';
  if (has('ufw')) return 'ufw';
  if (has('iptables')) return 'iptables';
  return null;
}

export function localIps() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Ignora adaptadores virtuales comunes para no confundir al usuario.
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback/i.test(iface);
      out.push({ interface: iface, address: a.address, virtual });
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

let publicCache = { at: 0, ip: null };
export async function publicIp() {
  if (publicCache.ip && Date.now() - publicCache.at < 5 * 60_000) return publicCache.ip;
  try {
    const { ip } = await getJson('https://api.ipify.org?format=json', { timeout: 8000 });
    publicCache = { at: Date.now(), ip };
    return ip;
  } catch {
    return null;
  }
}

/** Revisa si un puerto TCP está libre en esta PC. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/**
 * Pregunta a mcsrvstat.us (un servicio externo) si el servidor se ve desde internet.
 * Es la prueba real de que el reenvío de puertos funciona.
 */
export async function externalCheck(host, port, edition = 'java') {
  const address = `${encodeURIComponent(host)}${port ? `:${port}` : ''}`;
  const base = edition === 'bedrock' ? 'https://api.mcsrvstat.us/bedrock/3' : 'https://api.mcsrvstat.us/3';
  const data = await getJson(`${base}/${address}`, { timeout: 20000 });
  return {
    online: Boolean(data.online),
    ip: data.ip || null,
    port: data.port || port,
    version: data.version || null,
    players: data.players ? { online: data.players.online, max: data.players.max } : null,
    motd: data.motd?.clean?.join(' ') || null,
    debug: data.debug
      ? { ping: data.debug.ping, query: data.debug.query, srv: data.debug.srv, error: data.debug.error || null }
      : null,
  };
}
