import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

/**
 * Caso de uso: "Enciendo, apago y reinicio mi servidor, escribo comandos, veo quién entra,
 * y si se cae el panel me dice por qué y lo vuelve a levantar".
 */
describe('Encender, apagar, consola y jugadores', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Diario', type: 'vanilla', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('enciende y espera a que el servidor diga "Done"; no deja encenderlo dos veces', async () => {
    const first = await c.ok('POST', `/api/servers/${s.id}/start`);
    assert.ok(['starting', 'running'].includes(first.status));
    const rt = await panel.waitStatus(s.id, 'running');
    assert.ok(rt.pid > 0);
    assert.equal((await c.post(`/api/servers/${s.id}/start`)).status, 409);
  });

  it('manda comandos a la consola (con o sin /) y muestra la respuesta', async () => {
    await panel.command(s.id, '/say hola a todos');
    await panel.waitConsole(s.id, /> say hola a todos/);
    await panel.waitConsole(s.id, /\[Server\] hola a todos/);
  });

  it('un comando con salto de línea no puede colar un segundo comando', async () => {
    await panel.command(s.id, 'say uno\nstop');
    await panel.waitConsole(s.id, /\[Server\] uno stop/);
    assert.equal((await panel.status(s.id)).status, 'running');
  });

  it('sabe quién está conectado (entradas, salidas y respuesta de /list)', async () => {
    await panel.command(s.id, 'join Ana');
    await panel.command(s.id, 'join Beto');
    await waitFor(async () => (await panel.status(s.id)).players.length === 2, { message: 'dos jugadores' });
    await panel.command(s.id, 'leave Ana');
    await waitFor(async () => (await panel.status(s.id)).players.join() === 'Beto', { message: 'solo Beto' });
    const players = await c.ok('GET', `/api/servers/${s.id}/players`);
    assert.deepEqual(players.online, ['Beto']);
  });

  it('con el servidor encendido, las acciones de jugadores se mandan como comandos', async () => {
    await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'op', name: 'Beto' });
    await panel.waitConsole(s.id, /> op Beto/);
    await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'kick', name: 'Beto', reason: 'adiós\nstop' });
    await panel.waitConsole(s.id, /> kick Beto adiós stop/);
    assert.equal((await c.post(`/api/servers/${s.id}/players`, { action: 'op', name: 'mal nombre!' })).status, 400);
    assert.equal((await c.post(`/api/servers/${s.id}/players`, { action: 'borrar-todo', name: 'Beto' })).status, 400);
  });

  it('reinicia: se apaga y vuelve a encender solo', async () => {
    const before = (await panel.status(s.id)).pid;
    await c.ok('POST', `/api/servers/${s.id}/restart`);
    await waitFor(async () => {
      const rt = await panel.status(s.id);
      return rt.status === 'running' && rt.pid !== before;
    }, { timeout: 30000, message: 'que vuelva a encender' });
    assert.deepEqual((await panel.status(s.id)).players, [], 'al reiniciar no queda nadie conectado');
  });

  it('no deja cambiar el puerto ni borrar el servidor mientras está encendido', async () => {
    assert.equal((await c.patch(`/api/servers/${s.id}`, { port: s.port + 7 })).status, 409);
    assert.equal((await c.del(`/api/servers/${s.id}`)).status, 409);
    assert.equal((await c.post(`/api/servers/${s.id}/reinstall`, { mcVersion: '1.20.1' })).status, 409);
  });

  it('si se cae, dice la causa probable en español', async () => {
    await panel.command(s.id, 'crash');
    const rt = await panel.waitStatus(s.id, 'crashed');
    assert.equal(rt.lastCrash.code, 1);
    assert.equal(rt.lastCrash.findings[0].title, 'Se acabó la memoria');
    await panel.waitConsole(s.id, /Posible causa: Se acabó la memoria/);
  });

  it('con "reinicio automático" activado, lo vuelve a encender después de caerse', async () => {
    await c.ok('PATCH', `/api/servers/${s.id}`, { autoRestart: true });
    await panel.start(s.id);
    await panel.command(s.id, 'crash');
    await panel.waitStatus(s.id, 'crashed');
    await panel.waitConsole(s.id, /Reinicio automático en 10 s \(intento 1\/3\)/);
    await panel.waitStatus(s.id, 'running', 25000);
    await c.ok('PATCH', `/api/servers/${s.id}`, { autoRestart: false });
  });

  it('forzar cierre mata el proceso al momento', async () => {
    await c.ok('POST', `/api/servers/${s.id}/kill`);
    const rt = await panel.waitStatus(s.id, 'stopped');
    assert.equal(rt.pid ?? null, null);
    assert.equal((await c.post(`/api/servers/${s.id}/command`, { command: 'list' })).status, 409, 'apagado no acepta comandos');
  });

  it('guarda la actividad: encendidos, apagados, caídas y entradas/salidas', async () => {
    const all = await c.ok('GET', `/api/servers/${s.id}/activity`);
    const types = new Set(all.events.map((e) => e.type));
    for (const t of ['start', 'ready', 'join', 'leave', 'crash', 'stop']) assert.ok(types.has(t), `falta ${t}`);
    assert.equal(all.events.find((e) => e.type === 'crash').detail, 'Se acabó la memoria');
    assert.ok(all.events[0].t >= all.events.at(-1).t, 'del más nuevo al más viejo');
    const onlyPlayers = await c.ok('GET', `/api/servers/${s.id}/activity?filter=players`);
    assert.ok(onlyPlayers.events.every((e) => e.type === 'join' || e.type === 'leave'));
    assert.ok(onlyPlayers.events.some((e) => e.player === 'Ana'));
    assert.equal(all.heatmap.grid.length, 7);
    assert.equal(all.heatmap.uniquePlayers, 2);
    const page = await c.ok('GET', `/api/servers/${s.id}/activity?limit=2`);
    assert.equal(page.events.length, 2);
    assert.equal(page.more, true);
  });

  it('lee las estadísticas que guarda Minecraft por jugador', async () => {
    const dir = panel.serverDir(s.id);
    const uuid = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    fs.mkdirSync(path.join(dir, 'world', 'stats'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Ana', uuid }]));
    fs.writeFileSync(
      path.join(dir, 'world', 'stats', `${uuid}.json`),
      JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 72000, 'minecraft:deaths': 3, 'minecraft:walk_one_cm': 50000 }, 'minecraft:mined': { 'minecraft:stone': 40, 'minecraft:dirt': 2 } } })
    );
    const st = await c.ok('GET', `/api/servers/${s.id}/stats`);
    const ana = st.players.find((p) => p.uuid === uuid);
    assert.equal(ana.name, 'Ana');
    assert.equal(ana.playTime, 3600);
    assert.equal(ana.deaths, 3);
    assert.equal(ana.distance, 500);
    assert.equal(ana.blocksMined, 42);
    assert.deepEqual(ana.topMined[0], { id: 'stone', value: 40 });
    assert.ok(ana.sessions >= 1, 'cruza con la actividad del panel');
  });

  it('el inicio muestra el resumen de cada servidor', async () => {
    const d = await c.ok('GET', '/api/system/dashboard');
    const mine = d.servers.find((x) => x.id === s.id);
    assert.ok(mine.health?.level);
    assert.ok(Array.isArray(mine.spark.players));
  });

  it('apagado, administra jugadores editando los archivos (con UUID real u offline)', async () => {
    const r = await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'whitelist-add', name: 'Notch' });
    assert.deepEqual(r.whitelist, [{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' }]);
    const missing = await c.post(`/api/servers/${s.id}/players`, { action: 'op', name: 'NoExisteNadie' });
    assert.equal(missing.status, 404);
    assert.match(missing.body.error, /No existe una cuenta/);

    await c.ok('PUT', `/api/servers/${s.id}/properties`, { 'online-mode': 'false' });
    const op = await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'op', name: 'Notch' });
    assert.equal(op.ops[0].uuid, 'b50ad385-829d-3141-a216-7e7d7539ba7f', 'en modo offline usa el UUID offline');
    assert.equal(op.ops[0].level, 4);

    const ban = await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'ban', name: 'Griefer', reason: 'romper casas' });
    assert.equal(ban.banned[0].reason, 'romper casas');
    const pardon = await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'pardon', name: 'griefer' });
    assert.deepEqual(pardon.banned, [], 'sin importar mayúsculas');
    await c.ok('POST', `/api/servers/${s.id}/players`, { action: 'ban-ip', name: '45.1.2.3' });
    assert.equal((await c.post(`/api/servers/${s.id}/players`, { action: 'ban-ip', name: '45.1.2.3; rm' })).status, 400);
    assert.equal((await c.post(`/api/servers/${s.id}/players`, { action: 'kick', name: 'Notch' })).status, 409);
    const onDisk = JSON.parse(fs.readFileSync(path.join(panel.serverDir(s.id), 'banned-ips.json'), 'utf8'));
    assert.equal(onDisk[0].ip, '45.1.2.3');
  });

  it('cambia ajustes: nombre, memoria, puerto (y lo escribe en server.properties)', async () => {
    const list = await c.ok('GET', '/api/servers');
    const other = await panel.createServer({ name: 'Otro', type: 'vanilla', mcVersion: '1.21.4' });
    assert.equal((await c.patch(`/api/servers/${s.id}`, { port: other.port })).status, 409, 'puerto de otro servidor');
    const newPort = Math.max(...list.map((x) => x.port), other.port) + 3;
    const upd = await c.ok('PATCH', `/api/servers/${s.id}`, { name: '  Renombrado  ', memoryMb: 100, port: newPort });
    assert.equal(upd.name, 'Renombrado');
    assert.equal(upd.memoryMb, 512, 'mínimo 512 MB');
    assert.equal(upd.port, newPort);
    const props = await c.ok('GET', `/api/servers/${s.id}/properties`);
    assert.equal(props['server-port'], String(newPort));
    const r = await c.ok('PUT', `/api/servers/${s.id}/properties`, { motd: '§6Hola\n§aMundo', 'max-players': '5' });
    assert.equal(r.restartRequired, false);
    assert.match(fs.readFileSync(path.join(panel.serverDir(s.id), 'server.properties'), 'utf8'), /motd=\\u00a76Hola\\n\\u00a7aMundo/);
  });

  it('elimina el servidor con sus archivos (y opcionalmente conserva los respaldos)', async () => {
    const dir = panel.serverDir(s.id);
    await c.ok('DELETE', `/api/servers/${s.id}`);
    assert.ok(!fs.existsSync(dir));
    assert.equal((await c.get(`/api/servers/${s.id}`)).status, 404);
    assert.ok(!(await c.ok('GET', '/api/servers')).some((x) => x.id === s.id));
  });
});
