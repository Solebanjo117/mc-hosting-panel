import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor, sleep } from '../helpers/panel.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Casos de uso:
 *  - "Quiero reinicios, respaldos y mensajes automáticos a ciertas horas."
 *  - "Quiero leer y buscar en los logs, y que me explique los crash reports."
 *  - "Quiero saber si mi servidor es seguro y arreglarlo con un clic; y que me proteja de bots."
 *  - "Quiero ver el uso de CPU, RAM y jugadores."
 */
describe('Tareas programadas, logs, seguridad y rendimiento', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  let dir;
  const M = () => `/api/servers/${s.id}`;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Admin', type: 'paper', mcVersion: '1.21.4' });
    dir = panel.serverDir(s.id);
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  describe('Tareas programadas', () => {
    it('valida las tareas', async () => {
      const bad = [
        [{ action: 'formatear', when: { type: 'interval', minutes: 30 } }, /Acción inválida/],
        [{ action: 'backup', when: { type: 'interval', minutes: 1 } }, /5 minutos a 7 días/],
        [{ action: 'backup', when: { type: 'daily', time: '25:00', days: [1] } }, /Hora inválida/],
        [{ action: 'backup', when: { type: 'daily', time: '04:00', days: [] } }, /al menos un día/],
        [{ action: 'command', when: { type: 'interval', minutes: 30 } }, /Escribe el comando/],
        [{ action: 'message', when: { type: 'interval', minutes: 30 }, message: '  ' }, /Escribe el mensaje/],
      ];
      for (const [body, re] of bad) {
        const r = await c.post(`${M()}/schedules`, body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match(r.body.error, re);
      }
    });

    it('crea, edita y borra tareas, y calcula la próxima ejecución', async () => {
      let r = await c.ok('POST', `${M()}/schedules`, { action: 'restart', when: { type: 'daily', time: '04:00', days: [0, 1, 2, 3, 4, 5, 6] }, warnMinutes: 5, backupBefore: true, label: 'Reinicio diario' });
      const t = r.tasks[0];
      assert.equal(t.warnMinutes, 5);
      assert.equal(t.backupBefore, true);
      const next = new Date(t.nextRun);
      assert.equal(`${pad(next.getHours())}:${pad(next.getMinutes())}`, '04:00');
      assert.ok(next > new Date());
      r = await c.ok('PUT', `${M()}/schedules/${t.id}`, { action: 'stop', when: { type: 'daily', time: '23:30', days: [5, 5, 6, 9] }, backupBefore: true });
      assert.deepEqual(r.tasks[0].when.days, [5, 6], 'sin repetidos ni días inválidos');
      assert.equal(r.tasks[0].backupBefore, false, 'el respaldo previo es solo para reinicios');
      r = await c.ok('DELETE', `${M()}/schedules/${t.id}`);
      assert.equal(r.tasks.length, 0);
      assert.equal((await c.put(`${M()}/schedules/no-existe`, { action: 'backup', when: { type: 'interval', minutes: 30 } })).status, 404);
    });

    it('ejecuta una tarea a mano: mensajes y comandos solo con el servidor encendido', async () => {
      let r = await c.ok('POST', `${M()}/schedules`, { action: 'message', when: { type: 'interval', minutes: 60 }, message: 'Vota por el servidor' });
      const msg = r.tasks.at(-1);
      await c.ok('POST', `${M()}/schedules/${msg.id}/run`);
      await waitFor(async () => (await c.ok('GET', `${M()}/schedules`)).log.some((l) => l.taskId === msg.id), { message: 'registro de la tarea' });
      assert.match((await c.ok('GET', `${M()}/schedules`)).log[0].result, /omitida: el servidor estaba apagado \(manual\)/);

      await panel.start(s.id);
      await c.ok('POST', `${M()}/schedules/${msg.id}/run`);
      await panel.waitConsole(s.id, /> say Vota por el servidor/);
      r = await c.ok('POST', `${M()}/schedules`, { action: 'command', when: { type: 'interval', minutes: 60 }, command: '/time set day' });
      await c.ok('POST', `${M()}/schedules/${r.tasks.at(-1).id}/run`);
      await panel.waitConsole(s.id, /> time set day/);
      assert.equal((await c.post(`${M()}/schedules/nada/run`)).status, 404);
    });

    it('reinicio programado: avisa, respalda y reinicia', async () => {
      const r = await c.ok('POST', `${M()}/schedules`, { action: 'restart', when: { type: 'interval', minutes: 60 }, backupBefore: true });
      const pid = (await panel.status(s.id)).pid;
      await c.ok('POST', `${M()}/schedules/${r.tasks.at(-1).id}/run`);
      await panel.waitConsole(s.id, /Guardando un respaldo antes de reiniciar/);
      await waitFor(async () => {
        const rt = await panel.status(s.id);
        return rt.status === 'running' && rt.pid !== pid;
      }, { timeout: 30000, message: 'el reinicio' });
      assert.ok((await c.ok('GET', `${M()}/backups`)).backups.some((b) => b.file.endsWith('-programado.zip')));
    });

    it('se ejecuta sola a la hora indicada', async () => {
      const now = new Date();
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const r = await c.ok('POST', `${M()}/schedules`, { action: 'message', when: { type: 'daily', time, days: [now.getDay()] }, message: 'Tarea automática' });
      const id = r.tasks.at(-1).id;
      await panel.waitConsole(s.id, /> say Tarea automática/, 25000);
      const log = await waitFor(async () => (await c.ok('GET', `${M()}/schedules`)).log.find((l) => l.taskId === id), { message: 'registro' });
      assert.equal(log.result, 'enviado');
      await sleep(16000);
      const text = await panel.consoleText(s.id);
      assert.equal(text.match(/> say Tarea automática/g).length, 1, 'no se repite el mismo día');
      await panel.stop(s.id);
    });
  });

  describe('Logs y crash reports', () => {
    it('lista logs (latest.log primero), los lee, filtra y busca también en los .log.gz', async () => {
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), '[INFO] Hola\n[WARN] Algo raro con Ana\n[INFO] Adiós\n');
      fs.writeFileSync(path.join(dir, 'logs', '2026-10-01-1.log.gz'), zlib.gzipSync('[INFO] Ana entró ayer\n'));
      const list = await c.ok('GET', `${M()}/logs`);
      assert.deepEqual(list.logs.map((l) => l.file), ['latest.log', '2026-10-01-1.log.gz']);
      const full = await c.ok('GET', `${M()}/logs/file/latest.log`);
      assert.equal(full.lines.length, 4);
      const filtered = await c.ok('GET', `${M()}/logs/file/latest.log?q=raro`);
      assert.deepEqual(filtered.lines, [{ n: 2, text: '[WARN] Algo raro con Ana' }]);
      const all = await c.ok('GET', `${M()}/logs/search?q=ana`);
      assert.deepEqual(all.results.map((r) => r.file).sort(), ['2026-10-01-1.log.gz', 'latest.log']);
      assert.equal((await c.get(`${M()}/logs/file/..%2F..%2F..%2Fdb.json`)).status, 400);
      assert.equal((await c.get(`${M()}/logs/raw/logs/..%2Fserver.properties`)).status, 404, 'la descarga directa solo sirve dentro de logs/');
      const raw = await c.request('GET', `${M()}/logs/raw/logs/latest.log`, { raw: true });
      assert.match(await raw.text(), /Algo raro/);
    });

    it('explica los crash reports y el último log', async () => {
      fs.mkdirSync(path.join(dir, 'crash-reports'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'crash-reports', 'crash-2026.txt'), 'java.lang.UnsupportedClassVersionError: Mod has been compiled by a more recent version of the Java Runtime (class file version 65.0)');
      const crash = await c.ok('GET', `${M()}/logs/crash/crash-2026.txt`);
      assert.equal(crash.findings[0].title, 'Algo necesita Java 21');
      fs.appendFileSync(path.join(dir, 'logs', 'latest.log'), '**** FAILED TO BIND TO PORT!\n');
      const d = await c.ok('GET', `${M()}/logs/diagnose`);
      assert.ok(d.findings.length > 0);
    });
  });

  describe('Seguridad', () => {
    it('revisa la configuración y la arregla con un clic', async () => {
      await c.ok('PUT', `${M()}/properties`, { 'online-mode': 'false', 'enable-rcon': 'true', 'rcon.password': 'corta' });
      let sec = await c.ok('GET', `${M()}/security`);
      const ids = (lvl) => sec.findings.filter((f) => f.level === lvl).map((f) => f.id);
      assert.ok(ids('critical').includes('online-mode'));
      assert.ok(ids('critical').includes('rcon'));
      sec = await c.ok('POST', `${M()}/security/fix`, { fix: 'online-mode' });
      sec = await c.ok('POST', `${M()}/security/fix`, { fix: 'rcon' });
      assert.equal(ids('critical').length, 0);
      const props = await c.ok('GET', `${M()}/properties`);
      assert.equal(props['online-mode'], 'true');
      assert.equal(props['enable-rcon'], 'false');
      assert.ok(props['rcon.password'].length >= 24, 'cambia la contraseña de RCON por una larga');
      await c.ok('POST', `${M()}/security/fix`, { fix: 'whitelist' });
      assert.equal((await c.ok('GET', `${M()}/properties`))['white-list'], 'true');
      await c.ok('POST', `${M()}/security/fix`, { fix: 'backups' });
      assert.equal((await c.ok('GET', `/api/servers/${s.id}`)).backupSchedule.enabled, true);
      assert.equal((await c.post(`${M()}/security/fix`, { fix: 'magia' })).status, 400);
      await c.ok('PUT', `${M()}/properties`, { 'white-list': 'false' });
    });

    it('ajusta la protección contra bots con límites razonables', async () => {
      const r = await c.ok('PUT', `${M()}/security/protection`, { enabled: true, perIpPerMinute: 1, globalPerMinute: 9999, banMinutes: 'x', lockdownMinutes: 5 });
      assert.deepEqual(r.protection.settings, { enabled: true, perIpPerMinute: 3, globalPerMinute: 500, banMinutes: 60, lockdownMinutes: 5 });
    });

    it('bloquea una IP que se conecta demasiadas veces y activa la lista blanca ante una oleada', async () => {
      await c.ok('PUT', `${M()}/security/protection`, { enabled: true, perIpPerMinute: 3, globalPerMinute: 5, banMinutes: 1, lockdownMinutes: 1 });
      await panel.start(s.id);
      // Una IP pública que entra una y otra vez (el panel cuenta una vez cada 3 s por IP).
      for (let i = 0; i < 4; i++) {
        await panel.command(s.id, 'join Bot 45.9.9.9');
        await sleep(3100);
      }
      await panel.waitConsole(s.id, /> ban-ip 45\.9\.9\.9 Demasiadas conexiones/);
      // Las IP de la casa o de playit (127.0.0.1) nunca se bloquean.
      for (let i = 0; i < 4; i++) await panel.command(s.id, 'join Amigo 192.168.1.20');
      // Oleada desde muchas IP distintas.
      await panel.command(s.id, 'flood 10');
      await panel.waitConsole(s.id, /> whitelist on/);
      const sec = await c.ok('GET', `${M()}/security`);
      assert.ok(sec.protection.lockdownUntil);
      assert.deepEqual(sec.protection.bans.map((b) => b.ip), ['45.9.9.9']);
      assert.ok(sec.protection.log.some((l) => l.type === 'lockdown'));
      assert.ok(!(await panel.consoleText(s.id)).includes('ban-ip 192.168'));

      await c.ok('POST', `${M()}/security/end-lockdown`);
      await panel.waitConsole(s.id, /> whitelist off/);
      assert.equal((await c.ok('GET', `${M()}/security`)).protection.lockdownUntil, null);
    });
  });

  describe('Rendimiento', () => {
    it('entrega las métricas por rango', async () => {
      for (const range of ['1h', '6h', '24h', '7d']) {
        const m = await c.ok('GET', `${M()}/metrics?range=${range}`);
        assert.equal(m.range, range);
        assert.ok(Array.isArray(m.points));
      }
      const rt = await panel.status(s.id);
      assert.ok(rt.pid);
      await panel.stop(s.id);
    });

    it('muestra el uso de disco del servidor y de sus respaldos', async () => {
      const d = await c.ok('GET', `${M()}/disk`);
      assert.ok(d.server > 0);
      assert.ok(d.backups > 0);
    });
  });
});
