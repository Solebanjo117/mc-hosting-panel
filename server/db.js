import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DEFAULT_PANEL_PORT } from './config.js';
import { JsonStore } from './lib/store.js';

export const db = new JsonStore(path.join(DATA_DIR, 'db.json'), {
  admin: null, // { username, passwordHash }
  jwtSecret: null,
  settings: {
    panelPort: DEFAULT_PANEL_PORT,
    javaPaths: {}, // { "21": "C:\\ruta\\java.exe" } para usar un Java propio
  },
  servers: [],
});

if (!db.data.jwtSecret) {
  db.data.jwtSecret = crypto.randomBytes(48).toString('hex');
  db.flush();
}

export function getServer(id) {
  return db.data.servers.find((s) => s.id === id) || null;
}

export function updateServer(id, patch) {
  const server = getServer(id);
  if (!server) return null;
  Object.assign(server, patch);
  db.save();
  return server;
}
