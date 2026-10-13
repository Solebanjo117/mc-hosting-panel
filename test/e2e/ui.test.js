import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, ROOT, ADMIN } from '../helpers/panel.js';

/**
 * Pruebas en el navegador (opcionales). Necesitan:
 *  - el panel compilado (npm run build)
 *  - Playwright: npm i --no-save playwright && npx playwright install chromium
 *    (o PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright si ya lo tienes en otro lado)
 */
async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  for (const c of candidates) {
    try {
      const req = createRequire(path.join(ROOT, 'package.json'));
      return req(c);
    } catch {
      /* siguiente */
    }
  }
  return null;
}

const pw = await loadPlaywright();
const built = fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
const skip = !hasJava() ? 'Se necesita Java' : !built ? 'Compila el panel primero (npm run build)' : !pw ? 'Instala Playwright para las pruebas en el navegador' : false;

describe('Panel en el navegador', { skip }, () => {
  let mocks;
  let panel;
  let browser;
  let page;
  const errors = [];
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks, setup: false });
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browser = await pw.chromium.launch({ executablePath });
    page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'es-MX' });
    page.on('pageerror', (err) => errors.push(`Error de la página: ${err.message}`));
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 500) errors.push(`${res.status()} en ${res.url()}`);
    });
  });
  after(async () => {
    await browser?.close();
    await panel?.close();
    await mocks?.close();
  });

  it('la primera vez pide crear la cuenta y entra', async () => {
    await page.goto(panel.base);
    await page.getByRole('heading', { name: 'Bienvenido' }).waitFor();
    await page.getByLabel('Usuario').fill(ADMIN.username);
    await page.getByLabel(/^Contraseña/).fill(ADMIN.password);
    await page.getByLabel('Repite la contraseña').fill('otra-cosa-123');
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click();
    await page.getByText('Las contraseñas no coinciden').waitFor();
    await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click();
    await page.getByRole('link', { name: /Crear servidor|Nuevo servidor/ }).first().waitFor();
  });

  it('crea un servidor desde el formulario y lo deja instalado', async () => {
    await page.goto(`${panel.base}/nuevo`);
    await page.getByRole('radio', { name: /Paper/ }).click();
    await page.getByLabel('Nombre').fill('Desde el navegador');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Crear e instalar' }).click();
    await page.waitForURL(/\/servidor\/[^/]+$/);
    await page.getByRole('button', { name: 'Encender' }).waitFor({ timeout: 60000 });
  });

  it('enciende, escribe un comando y ve la respuesta en la consola en vivo', async () => {
    await page.getByRole('button', { name: 'Encender' }).click();
    await page.getByRole('button', { name: 'Apagar' }).waitFor({ timeout: 30000 });
    const input = page.getByLabel('Comando');
    await page.locator('.terminal').getByText(/Done \(/).waitFor({ timeout: 30000 });
    await input.fill('say hola desde el navegador');
    await input.press('Enter');
    await page.locator('.terminal').getByText('[Server] hola desde el navegador').waitFor();
  });

  it('todas las secciones abren sin errores', async () => {
    const base = page.url().replace(/\/$/, '');
    for (const sub of ['jugadores', 'actividad', 'contenido', 'datapacks', 'mundos', 'mapa', 'respaldos', 'archivos', 'conexion', 'bedrock', 'seguridad', 'rendimiento', 'logs', 'ajustes', 'tareas']) {
      await page.goto(`${base}/${sub}`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.error-box').count(), 0, `error visible en ${sub}`);
    }
    for (const p of ['/', '/ajustes', '/guia', '/nuevo/modpack']) {
      await page.goto(`${panel.base}${p}`);
      await page.waitForLoadState('networkidle');
    }
    assert.deepEqual(errors, []);
  });

  it('en el celular las pestañas caben y la página no se desborda a lo ancho', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    const list = await panel.client.request('GET', '/api/servers', { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } });
    await page.goto(`${panel.base}/servidor/${list.body[0].id}/tareas`);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `la página se desborda ${overflow}px`);
    const active = page.locator('.tabs .tab.active');
    const box = await active.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'la pestaña activa se ve completa');
  });
});
