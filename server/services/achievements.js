import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { bus } from '../lib/bus.js';
import { record, sessionsOf, eventsOf, playerStats } from './activity.js';
import { listBackups } from './backups.js';

/**
 * Logros del servidor: se calculan con lo que el panel ya sabe (sesiones, respaldos, caídas,
 * estadísticas de los jugadores). Al desbloquearse uno, se avisa con el cartel de logro del juego
 * y queda en la línea de tiempo.
 */

const H = 3600_000;
const DAY = 24 * H;

export const DEFINITIONS = [
  { id: 'primera-sesion', title: 'Primera noche', desc: 'Alguien jugó 20 minutos seguidos.', test: (f) => f.longestSession >= 20 * 60_000, progress: (f) => Math.min(1, f.longestSession / (20 * 60_000)) },
  { id: 'horas-10', title: 'Calentando motores', desc: '10 horas jugadas entre todos.', test: (f) => f.playerHours >= 10, progress: (f) => Math.min(1, f.playerHours / 10) },
  { id: 'horas-100', title: 'Cien horas', desc: '100 horas jugadas entre todos.', test: (f) => f.playerHours >= 100, progress: (f) => Math.min(1, f.playerHours / 100) },
  { id: 'horas-1000', title: 'Mil horas', desc: '1000 horas jugadas entre todos.', test: (f) => f.playerHours >= 1000, progress: (f) => Math.min(1, f.playerHours / 1000) },
  { id: 'duo', title: 'Mejor acompañado', desc: '2 jugadores a la vez.', test: (f) => f.maxConcurrent >= 2, progress: (f) => Math.min(1, f.maxConcurrent / 2) },
  { id: 'fiesta-5', title: 'Fiesta', desc: '5 jugadores a la vez.', test: (f) => f.maxConcurrent >= 5, progress: (f) => Math.min(1, f.maxConcurrent / 5) },
  { id: 'fiesta-10', title: 'Lleno total', desc: '10 jugadores a la vez.', test: (f) => f.maxConcurrent >= 10, progress: (f) => Math.min(1, f.maxConcurrent / 10) },
  { id: 'comunidad-5', title: 'Comunidad', desc: '5 personas distintas han jugado.', test: (f) => f.uniquePlayers >= 5, progress: (f) => Math.min(1, f.uniquePlayers / 5) },
  { id: 'comunidad-20', title: 'Pueblo', desc: '20 personas distintas han jugado.', test: (f) => f.uniquePlayers >= 20, progress: (f) => Math.min(1, f.uniquePlayers / 20) },
  { id: 'veterano-30', title: 'Un mes en pie', desc: 'El servidor tiene 30 días.', test: (f) => f.ageDays >= 30, progress: (f) => Math.min(1, f.ageDays / 30) },
  { id: 'veterano-365', title: 'Un año en pie', desc: 'El servidor cumple un año.', test: (f) => f.ageDays >= 365, progress: (f) => Math.min(1, f.ageDays / 365) },
  { id: 'estable-7', title: 'Roca sólida', desc: '7 días seguidos sin caídas (con gente jugando).', test: (f) => f.stableDays >= 7, progress: (f) => Math.min(1, f.stableDays / 7) },
  { id: 'respaldos-10', title: 'Previsor', desc: '10 respaldos guardados.', test: (f) => f.backups >= 10, progress: (f) => Math.min(1, f.backups / 10) },
  { id: 'minero-100k', title: 'Minería industrial', desc: '100 000 bloques minados entre todos.', test: (f) => f.blocksMined >= 100_000, progress: (f) => Math.min(1, f.blocksMined / 100_000) },
  { id: 'viajero-100km', title: 'Trotamundos', desc: '100 km recorridos entre todos.', test: (f) => f.distanceKm >= 100, progress: (f) => Math.min(1, f.distanceKm / 100) },
  { id: 'madrugadores', title: 'Madrugadores', desc: 'Alguien jugó entre las 4 y las 6 de la mañana.', test: (f) => f.earlyBird, progress: (f) => (f.earlyBird ? 1 : 0) },
  { id: 'maraton', title: 'Maratón', desc: 'Una sesión de 6 horas seguidas.', test: (f) => f.longestSession >= 6 * H, progress: (f) => Math.min(1, f.longestSession / (6 * H)) },
];

/** Los hechos a partir de los que se evalúan los logros. */
export function facts(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const now = Date.now();
  const sessions = sessionsOf(id);
  const events = eventsOf(id);
  const playerHours = sessions.reduce((n, s) => n + (s.end - s.start), 0) / H;
  const longestSession = sessions.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  // Máximo de jugadores a la vez: se barren inicios y fines ordenados.
  const marks = sessions.flatMap((s) => [[s.start, 1], [s.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let maxConcurrent = 0;
  for (const [, d] of marks) {
    cur += d;
    maxConcurrent = Math.max(maxConcurrent, cur);
  }
  const lastCrash = [...events].reverse().find((e) => e.type === 'crash')?.t || 0;
  const since = Math.max(lastCrash, Date.parse(server.createdAt || 0) || 0);
  const playedSince = sessions.some((s) => s.start >= since);
  const earlyBird = sessions.some((s) => {
    for (let t = s.start; t < s.end; t += 15 * 60_000) {
      const h = new Date(t).getHours();
      if (h >= 4 && h < 6) return true;
    }
    return false;
  });
  let blocksMined = 0;
  let distanceKm = 0;
  try {
    for (const p of playerStats(id).players) {
      blocksMined += p.blocksMined || 0;
      distanceKm += (p.distance || 0) / 1000;
    }
  } catch {
    /* sin estadísticas */
  }
  return {
    playerHours: Math.round(playerHours * 10) / 10,
    longestSession,
    maxConcurrent,
    uniquePlayers: new Set(sessions.map((s) => s.player)).size,
    ageDays: Math.floor((now - (Date.parse(server.createdAt || 0) || now)) / DAY),
    stableDays: playedSince ? Math.floor((now - since) / DAY) : 0,
    backups: listBackups(id).length,
    blocksMined,
    distanceKm: Math.round(distanceKm * 10) / 10,
    earlyBird,
  };
}

/** Evalúa y desbloquea; devuelve los nuevos. */
export function evaluate(id, { quiet = false } = {}) {
  const server = getServer(id);
  if (!server) return [];
  const f = facts(id);
  if (!server.achievements) server.achievements = {};
  const fresh = [];
  for (const d of DEFINITIONS) {
    if (server.achievements[d.id] || !d.test(f)) continue;
    server.achievements[d.id] = new Date().toISOString();
    fresh.push({ id: d.id, title: d.title, desc: d.desc });
  }
  if (fresh.length) {
    db.save();
    for (const a of fresh) {
      record(id, 'achievement', { detail: a.title });
      if (!quiet) bus.emit('achievement', id, a);
    }
  }
  return fresh;
}

export function list(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  evaluate(id);
  const f = facts(id);
  const got = server.achievements || {};
  return {
    facts: f,
    unlocked: Object.keys(got).length,
    total: DEFINITIONS.length,
    items: DEFINITIONS.map((d) => ({ id: d.id, title: d.title, desc: d.desc, at: got[d.id] || null, progress: got[d.id] ? 1 : Math.round(d.progress(f) * 100) / 100 })),
  };
}

// Se revisan cuando cambia algo (con calma) y cada 10 minutos.
const timers = new Map();
bus.on('status', (id) => {
  if (timers.has(id)) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      try {
        evaluate(id);
      } catch {
        /* servidor borrado */
      }
    }, 20_000)
  );
});
setInterval(() => {
  for (const s of db.data.servers) {
    try {
      evaluate(s.id);
    } catch {
      /* sin datos */
    }
  }
}, 10 * 60_000).unref();
