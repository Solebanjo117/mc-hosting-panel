import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Corre las pruebas: `npm test` (unitarias + casos de uso), `npm run test:unit`,
 * `npm run test:api`, `npm run test:e2e`, o `node test/run.js api/files` para un solo archivo o carpeta.
 */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const targets = process.argv.slice(2);
const wanted = targets.length ? targets : ['unit', 'api'];

function collect(p) {
  const abs = path.join(ROOT, p);
  if (fs.existsSync(`${abs}.test.js`)) return [`${abs}.test.js`];
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? collect(path.join(p, e.name)) : e.name.endsWith('.test.js') ? [path.join(abs, e.name)] : []))
    .sort();
}

const files = wanted.flatMap(collect);
if (!files.length) {
  console.error(`No hay pruebas en: ${wanted.join(', ')}`);
  process.exit(1);
}
const reporters = ['--test-reporter=spec', '--test-reporter-destination=stdout'];
if (process.env.GITHUB_ACTIONS) {
  reporters.push(`--test-reporter=${pathToFileURL(path.join(ROOT, 'reporters', 'github.js')).href}`, '--test-reporter-destination=stdout');
}
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...reporters, ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
