import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { DIST_DIR, VERSION } from './config.js';
import { db } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { serversRouter } from './routes/servers.js';
import { filesRouter } from './routes/files.js';
import { backupsRouter } from './routes/backups.js';
import { contentRouter } from './routes/content.js';
import { systemRouter } from './routes/system.js';
import { manageRouter } from './routes/manage.js';
import { integrationsRouter } from './routes/integrations.js';
import { appearancePublic, publicRouter } from './routes/appearance.js';
import * as playit from './services/playit.js';
import './services/metrics.js';
import './services/scheduler.js';
import './services/dns.js';
import './services/activity.js';
import './services/power.js';
import { attachWebSocket } from './ws.js';
import { guardHttp, securityHeaders, sameOrigin } from './lib/netguard.js';
import { autoStartServers, stopAll, rememberRunning } from './services/processManager.js';
import { localIps } from './services/network.js';
import { startInstall } from './services/installer.js';
import { bus } from './lib/bus.js';

const app = express();
app.disable('x-powered-by');
app.use(guardHttp);
app.use(securityHeaders);
// Respuestas comprimidas (gzip/brotli): la interfaz y las respuestas JSON grandes pesan una tercera parte.
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

app.use('/api', sameOrigin);
app.use('/api/auth', authRouter);
app.use('/api/appearance', appearancePublic);
app.use('/api/public', publicRouter);
app.use('/api', requireAuth);
app.use('/api/system', systemRouter);
app.use('/api/servers', serversRouter);
app.use('/api/servers/:id/files', filesRouter);
app.use('/api/servers/:id/backups', backupsRouter);
app.use('/api/servers/:id/content', contentRouter);
app.use('/api/servers/:id', manageRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api', (_req, _res, next) => next(Object.assign(new Error('Ruta no encontrada'), { status: 404 })));

if (fs.existsSync(DIST_DIR)) {
  // Los archivos de /assets llevan un hash en el nombre: se pueden guardar un año sin volver a pedirlos.
  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { index: false, immutable: true, maxAge: '1y', fallthrough: false }));
  // El resto (índice, service worker, manifest) se revalida siempre para que las actualizaciones lleguen al momento.
  app.use(express.static(DIST_DIR, { index: false, cacheControl: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html'), { cacheControl: false, headers: { 'Cache-Control': 'no-cache' } }));
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('Falta compilar la interfaz. Ejecuta "npm run build" o usa iniciar.bat.')
  );
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande' : err.message || 'Error interno';
  res.status(status).json({ error: message });
});

// Instalaciones que se interrumpieron porque el panel se cerró a la mitad.
for (const s of db.data.servers) {
  if (s.installState === 'installing' || s.installState === 'pending') startInstall(s.id);
}

const port = Number(process.env.PORT) || Number(db.data.settings.panelPort) || 8080;
const server = http.createServer(app);
attachWebSocket(server);

let listenTries = 0;
server.on('error', (err) => {
  // Tras actualizar, el panel nuevo puede arrancar antes de que el viejo suelte el puerto.
  if (err.code === 'EADDRINUSE' && process.env.MCP_RESTARTED && listenTries++ < 20) {
    setTimeout(() => server.listen(port, '0.0.0.0'), 1000);
    return;
  }
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${port} ya está en uso. ¿El panel ya está abierto en otra ventana?\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, '0.0.0.0', () => {
  const lan = localIps().filter((i) => !i.virtual);
  console.log(`\n  MC Hosting Panel v${VERSION}`);
  console.log(`  En esta PC:      http://localhost:${port}`);
  for (const ip of lan) console.log(`  En tu red local: http://${ip.address}:${port}`);
  console.log('\n  Cierra esta ventana (o Ctrl+C) para apagar el panel y los servidores.\n');
  const openBrowser = (process.env.OPEN_BROWSER === '1' || process.argv.includes('--abrir')) && !process.env.MCP_RESTARTED;
  if (openBrowser && process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', `http://localhost:${port}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  autoStartServers();
  playit.autoStart();
});

let shuttingDown = false;
async function shutdown(signal, { code = 0, afterExit = null } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  Apagando servidores (${signal})…`);
  db.flush();
  // Windows da pocos segundos al cerrar la ventana de consola (SIGHUP).
  await Promise.all([stopAll(signal === 'SIGHUP' ? 4000 : 20000), playit.stopAgent().catch(() => {})]);
  if (afterExit) afterExit();
  else if (code === 75 && !process.env.MCP_SUPERVISED) relaunch();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(sig));

/**
 * Reinicio después de actualizar. iniciar.bat (MCP_SUPERVISED) vuelve a abrir el panel cuando sale con
 * código 75; si se abrió de otra forma (npm start, acceso directo), el panel se relanza a sí mismo.
 */
function relaunch() {
  const args = process.argv.slice(1).filter((a) => a !== '--abrir');
  const env = { ...process.env, MCP_RESTARTED: '1' };
  if (process.platform === 'win32') {
    const q = (a) => `"${a}"`;
    const line = ['start', q('MC Hosting Panel'), '/min', q(process.execPath), ...args.map(q)].join(' ');
    spawn('cmd', ['/d', '/s', '/c', q(line)], { detached: true, stdio: 'ignore', env, cwd: process.cwd(), windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.execPath, args, { detached: true, stdio: 'inherit', env, cwd: process.cwd() }).unref();
  }
}
bus.on('app-restart', ({ code, afterExit }) => {
  console.log('\n  Actualización lista: reiniciando el panel…');
  rememberRunning();
  shutdown('actualización', { code, afterExit });
});
