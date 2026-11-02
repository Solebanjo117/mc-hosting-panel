import { VERSION } from '../config.js';
import { db } from '../db.js';
import { instance } from './processManager.js';
import { getAllMetrics, hostNow } from './metrics.js';
import { eventsOf } from './activity.js';
import { listBackups } from './backups.js';
import { growth } from './worldGrowth.js';

/**
 * Rendimiento general: lo que hace falta para la página que resume todos los servidores
 * y la PC en una sola llamada (tarjetas de arriba, gráficas y tabla por servidor).
 */

const DAY = 24 * 3600_000;

async function worldBytes(id) {
  try {
    return (await growth(id)).summary?.bytes ?? null;
  } catch {
    return null;
  }
}

export async function overview(range = '6h', allow = () => true) {
  const metrics = getAllMetrics(range, Date.now(), allow);
  const since = Date.now() - DAY;
  const servers = await Promise.all(
    db.data.servers
      .filter((s) => allow(s.id))
      .map(async (s) => {
        const inst = instance(s.id);
        const snap = inst.snapshot();
        const events = eventsOf(s.id);
        const backup = listBackups(s.id)[0] || null;
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          mcVersion: s.mcVersion,
          memoryLimitMb: s.memoryMb || null,
          status: s.installState === 'ready' ? snap.status : s.installState,
          players: snap.players.length,
          startedAt: snap.startedAt,
          cpu: snap.stats?.cpu ?? null,
          memMb: snap.stats?.memoryMb ?? null,
          tps: snap.tps,
          crashes24h: events.filter((e) => e.type === 'crash' && e.t >= since).length,
          lastBackupAt: backup?.createdAt || null,
          worldBytes: await worldBytes(s.id),
        };
      })
  );
  const running = servers.filter((s) => s.status === 'running');
  return {
    ...metrics,
    now: {
      version: VERSION,
      uptime: Math.round(process.uptime()),
      host: hostNow(),
      servers,
      totals: {
        servers: servers.length,
        running: running.length,
        players: running.reduce((n, s) => n + s.players, 0),
        memMb: running.reduce((n, s) => n + (s.memMb || 0), 0),
        reservedMb: running.reduce((n, s) => n + (s.memoryLimitMb || 0), 0),
        crashes24h: servers.reduce((n, s) => n + s.crashes24h, 0),
        lastBackupAt:
          servers
            .map((s) => s.lastBackupAt)
            .filter(Boolean)
            .sort()
            .at(-1) || null,
      },
    },
  };
}
