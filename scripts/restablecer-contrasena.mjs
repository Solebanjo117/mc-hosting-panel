/**
 * Restablecer la contraseña del panel si la olvidaste. Se usa en la PC donde corre el panel:
 *   - con git: restablecer-contrasena.bat
 *   - con el instalador: menú Inicio > "MC Hosting Panel - Restablecer contraseña"
 * Deja la nueva contraseña (ya cifrada) en la carpeta data; el panel la aplica al momento si está
 * abierto, o al abrirlo. Cierra todas las sesiones abiertas.
 */
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DATA_DIR } from '../server/config.js';

const RESET_FILE = path.join(DATA_DIR, 'restablecer-contrasena.json');
const pauseAtEnd = process.argv.includes('--pausa');
const say = (text = '') => process.stdout.write(`${text}\n`);

// Sin teclado (pruebas o redirección), se leen las respuestas de la entrada estándar.
let piped = null;
if (!process.stdin.isTTY) {
  let all = '';
  for await (const chunk of process.stdin) all += chunk;
  piped = all.split(/\r?\n/);
}

/** Pregunta por la consola; con `hidden` muestra asteriscos en lugar de lo que escribes. */
function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  if (piped) {
    const answer = piped.shift() ?? '';
    say();
    return Promise.resolve(answer);
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let text = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          say();
          return resolve(text);
        }
        if (ch === '\u0003') {
          say();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (text) {
            text = text.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        text += ch;
        process.stdout.write(hidden ? '*' : ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function finish(code) {
  if (pauseAtEnd && !piped) await ask('\n  Presiona Enter para cerrar.');
  process.exit(code);
}

async function panelRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let data = {};
try {
  data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8'));
} catch {
  /* sin base de datos todavía */
}
const current = data.admin?.username || null;
const port = Number(process.env.PORT) || Number(data.settings?.panelPort) || 8080;

say();
say('  Restablecer la contraseña de MC Hosting Panel');
say();
if (current) say(`  Tu usuario es: ${current}`);
else say('  Todavía no hay cuenta: se creará con estos datos.');

let username = (await ask(`  Usuario ${current ? '(Enter para dejarlo igual)' : ''}: `)).trim() || current;
if (!username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
  say('  El usuario debe tener de 3 a 32 caracteres (letras, números, _ . -).');
  await finish(1);
}

let password = '';
for (let tries = 0; tries < 3; tries++) {
  const first = await ask('  Nueva contraseña (mínimo 8 caracteres): ', { hidden: true });
  if (first.length < 8) {
    say('  Es muy corta: usa al menos 8 caracteres.');
    continue;
  }
  const second = await ask('  Repítela: ', { hidden: true });
  if (first !== second) {
    say('  No coinciden. Intenta de nuevo.');
    continue;
  }
  password = first;
  break;
}
if (!password) {
  say('  No se cambió nada.');
  await finish(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(RESET_FILE, JSON.stringify({ username, passwordHash: await bcrypt.hash(password, 12), at: new Date().toISOString() }), { mode: 0o600 });

say();
if (await panelRunning(port)) {
  // El panel abierto lo aplica en un par de segundos y borra el archivo.
  for (let i = 0; i < 20 && fs.existsSync(RESET_FILE); i++) await new Promise((r) => setTimeout(r, 300));
  if (fs.existsSync(RESET_FILE)) say('  Listo. El panel la aplicará en unos segundos.');
  else say(`  Listo. Ya puedes entrar como "${username}" con tu nueva contraseña (http://localhost:${port}).`);
} else {
  say(`  Listo. Se aplicará cuando abras el panel; entra como "${username}" con tu nueva contraseña.`);
}
say('  Por seguridad se cerraron las sesiones abiertas en otros dispositivos.');
await finish(0);
