import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, waitFor } from '../helpers/panel.js';

/**
 * Casos de uso:
 *  - "Quiero actualizar el panel desde el propio panel, sin abrir una consola."
 *  - "Quiero que el panel se abra solo al iniciar Windows."
 */

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@x' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();

/** Un "GitHub" local: repositorio remoto, la copia del panel y otra copia desde donde se publican cambios. */
function fakeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-upd-'));
  const remote = path.join(root, 'remoto.git');
  const app = path.join(root, 'panel');
  const dev = path.join(root, 'dev');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, dev);
  git(dev, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dev, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }));
  fs.writeFileSync(path.join(dev, 'LEEME.md'), 'hola\n');
  git(dev, 'add', '.');
  git(dev, 'commit', '-q', '-m', 'Primera versión');
  git(dev, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', '-b', 'main', remote, app);
  const publish = (file, content, message) => {
    fs.writeFileSync(path.join(dev, file), content);
    git(dev, 'add', '.');
    git(dev, 'commit', '-q', '-m', message);
    git(dev, 'push', '-q');
    return git(dev, 'rev-parse', 'HEAD');
  };
  return { root, app, publish, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('Actualizar el panel', () => {
  let mocks;
  before(async () => {
    mocks = await startMocks();
  });
  after(async () => {
    await mocks?.close();
  });

  describe('instalado con git', () => {
    let repo;
    let panel;
    before(async () => {
      repo = fakeRepo();
      panel = await startPanel({ mocks, env: { MCP_APP_ROOT: repo.app, MCP_UPDATE_NO_RESTART: '1' } });
    });
    after(async () => {
      await panel?.close();
      repo?.cleanup();
    });

    it('detecta el modo y dice que está al día', async () => {
      const st = await panel.client.ok('GET', '/api/system/update');
      assert.equal(st.mode, 'git');
      assert.equal(st.running, false);
      const r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.available, false);
      assert.equal(r.lastCheck.behind, 0);
    });

    it('muestra los cambios nuevos, los descarga y no toca lo demás', async () => {
      repo.publish('LEEME.md', 'hola de nuevo\n', 'Arreglo: el mapa se ve bien');
      const head = repo.publish('nuevo.txt', 'x', 'Novedad: pregenerar el mundo');
      const r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.available, true);
      assert.equal(r.lastCheck.behind, 2);
      assert.deepEqual(r.lastCheck.changes.map((c) => c.subject), ['Novedad: pregenerar el mundo', 'Arreglo: el mapa se ve bien']);
      assert.equal(r.lastCheck.dirty, false);

      const started = await panel.client.post('/api/system/update');
      assert.equal(started.status, 202);
      const done = await waitFor(async () => {
        const st = await panel.client.ok('GET', '/api/system/update');
        return !st.running && st.done ? st : null;
      }, { message: 'que termine de actualizar' });
      assert.equal(done.error, null);
      assert.equal(git(repo.app, 'rev-parse', 'HEAD'), head);
      assert.ok(fs.existsSync(path.join(repo.app, 'nuevo.txt')));
      assert.ok(!done.log.some((l) => /npm/.test(l)), 'sin cambios de dependencias ni de la interfaz no se reinstala nada');
      assert.match(done.log.at(-1), /Reiniciando/);
    });

    it('avisa si hay archivos modificados a mano', async () => {
      repo.publish('LEEME.md', 'otra vez\n', 'Otro cambio');
      fs.writeFileSync(path.join(repo.app, 'LEEME.md'), 'lo cambié yo\n');
      const r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.dirty, true);
      await panel.client.post('/api/system/update');
      const st = await waitFor(async () => {
        const s = await panel.client.ok('GET', '/api/system/update');
        return !s.running ? s : null;
      });
      assert.match(st.error, /git pull falló/);
      assert.equal(fs.readFileSync(path.join(repo.app, 'LEEME.md'), 'utf8'), 'lo cambié yo\n', 'no pisa lo que cambió el usuario');
    });
  });

  it('al terminar, el panel se cierra con el código 75 para que iniciar.bat lo vuelva a abrir', async () => {
    const repo = fakeRepo();
    const panel = await startPanel({ mocks, env: { MCP_APP_ROOT: repo.app, MCP_SUPERVISED: '1' } });
    try {
      repo.publish('LEEME.md', 'v2\n', 'Versión 2');
      await panel.client.ok('POST', '/api/system/update/check');
      await panel.client.post('/api/system/update');
      const code = await Promise.race([panel.exited, new Promise((r) => setTimeout(() => r('sigue abierto'), 30_000))]);
      assert.equal(code, 75);
      assert.match(panel.log, /reiniciando el panel/);
    } finally {
      await panel.close();
      repo.cleanup();
    }
  });

  describe('instalado con el instalador de Windows', () => {
    let panel;
    before(async () => {
      panel = await startPanel({ mocks, env: { MCP_UPDATE_MODE: 'installer', MCP_UPDATE_NO_RESTART: '1' } });
    });
    after(async () => {
      mocks.state.release = null;
      await panel?.close();
    });

    it('sin versiones publicadas lo explica', async () => {
      mocks.state.release = null;
      const r = await panel.client.post('/api/system/update/check');
      assert.equal(r.status, 502);
      assert.match(r.body.error, /No hay versiones publicadas/);
    });

    it('compara con la última versión publicada', async () => {
      mocks.state.release = { tag_name: 'v0.0.1', body: '', assets: [{ name: 'MC-Hosting-Panel-Setup-0.0.1.exe', browser_download_url: 'https://github.com/x/releases-assets/a.exe', size: 1 }] };
      let r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.available, false, 'una versión más vieja no es actualización');

      mocks.state.release = {
        tag_name: 'v99.0.0',
        body: '## Novedades\n- Todo mejor',
        assets: [
          { name: 'notas.txt', browser_download_url: 'https://github.com/x/releases-assets/notas.txt', size: 1 },
          { name: 'MC-Hosting-Panel-Setup-99.0.0.exe', browser_download_url: 'https://github.com/Solebanjo117/mc-hosting-panel/releases-assets/setup.exe', size: 22 },
        ],
      };
      r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.available, true);
      assert.equal(r.lastCheck.latest, '99.0.0');
      assert.equal(r.lastCheck.asset.name, 'MC-Hosting-Panel-Setup-99.0.0.exe');
      assert.match(r.lastCheck.notes, /Todo mejor/);
    });

    it('descarga el instalador nuevo para ejecutarlo al cerrar', async () => {
      await panel.client.post('/api/system/update');
      const st = await waitFor(async () => {
        const s = await panel.client.ok('GET', '/api/system/update');
        return !s.running && s.done ? s : null;
      });
      assert.equal(st.error, null);
      const file = path.join(panel.dataDir, 'tmp', 'MC-Hosting-Panel-Setup-99.0.0.exe');
      assert.equal(fs.readFileSync(file, 'utf8'), 'MZ instalador simulado');
    });
  });

  it('una copia sin git ni instalador explica cómo actualizar a mano', async () => {
    const panel = await startPanel({ mocks, env: { MCP_UPDATE_MODE: 'manual' } });
    try {
      const r = await panel.client.ok('POST', '/api/system/update/check');
      assert.equal(r.lastCheck.available, false);
      assert.match(r.lastCheck.message, /conservando la carpeta data/);
      const u = await panel.client.post('/api/system/update');
      assert.equal(u.status, 409);
    } finally {
      await panel.close();
    }
  });
});

describe('Iniciar con Windows', () => {
  let panel;
  let dir;
  let app;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-inicio-'));
    app = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-app-'));
    panel = await startPanel({ env: { MCP_STARTUP_DIR: dir, MCP_APP_ROOT: app } });
  });
  after(async () => {
    await panel?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(app, { recursive: true, force: true });
  });

  it('fuera de Windows no se ofrece', { skip: process.platform === 'win32' }, async () => {
    assert.deepEqual(await panel.client.ok('GET', '/api/system/startup'), { supported: false, enabled: false });
    assert.equal((await panel.client.put('/api/system/startup', { enabled: true })).status, 400);
  });

  it('crea y quita el acceso directo de la carpeta Inicio', { skip: process.platform !== 'win32' }, async () => {
    const link = path.join(dir, 'MC Hosting Panel.lnk');
    let st = await panel.client.ok('GET', '/api/system/startup');
    assert.equal(st.enabled, false);
    st = await panel.client.ok('PUT', '/api/system/startup', { enabled: true });
    assert.equal(st.enabled, true);
    assert.ok(fs.existsSync(link));
    st = await panel.client.ok('PUT', '/api/system/startup', { enabled: false });
    assert.equal(st.enabled, false);
    assert.ok(!fs.existsSync(link));
    assert.equal((await panel.client.put('/api/system/startup', {})).status, 400);
  });
});
