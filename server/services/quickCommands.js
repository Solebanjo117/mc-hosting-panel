import crypto from 'node:crypto';
import { db } from '../db.js';
import { HttpError } from '../lib/util.js';

/**
 * Comandos rápidos de la consola. Son los mismos para todos los servidores.
 * Un comando puede tener huecos como {jugador} o {objeto}; al usarlo, el panel
 * pide cada valor con la lista adecuada (jugadores conectados, objetos del juego…).
 */

export const PARAM_TYPES = ['player', 'item', 'effect', 'enchantment', 'entity', 'gamemode', 'number', 'text', 'select'];

const p = (name, type, extra = {}) => ({ name, type, default: '', options: [], ...extra });

export const DEFAULT_COMMANDS = [
  { label: 'Guardar mundo', template: 'save-all', params: [] },
  { label: 'Hacer de día', template: 'time set day', params: [] },
  { label: 'Quitar lluvia', template: 'weather clear', params: [] },
  { label: 'Lista de jugadores', template: 'list', params: [] },
  {
    label: 'Dar objeto',
    template: 'give {jugador} {objeto} {cantidad}',
    params: [p('jugador', 'player'), p('objeto', 'item'), p('cantidad', 'number', { default: '1' })],
  },
  { label: 'Modo de juego', template: 'gamemode {modo} {jugador}', params: [p('modo', 'gamemode', { default: 'creative' }), p('jugador', 'player')] },
  { label: 'Teletransportar', template: 'tp {jugador} {destino}', params: [p('jugador', 'player'), p('destino', 'player')] },
  {
    label: 'Dar efecto',
    template: 'effect give {jugador} {efecto} {segundos} {nivel}',
    params: [p('jugador', 'player'), p('efecto', 'effect'), p('segundos', 'number', { default: '60' }), p('nivel', 'number', { default: '0' })],
  },
  {
    label: 'Encantar',
    template: 'enchant {jugador} {encantamiento} {nivel}',
    params: [p('jugador', 'player'), p('encantamiento', 'enchantment'), p('nivel', 'number', { default: '1' })],
  },
  { label: 'Dar experiencia', template: 'xp add {jugador} {niveles} levels', params: [p('jugador', 'player'), p('niveles', 'number', { default: '5' })] },
  { label: 'Invocar junto a jugador', template: 'execute at {jugador} run summon {entidad}', params: [p('jugador', 'player'), p('entidad', 'entity')] },
  { label: 'Mensaje a todos', template: 'say {mensaje}', params: [p('mensaje', 'text')] },
  { label: 'Expulsar', template: 'kick {jugador} {motivo}', params: [p('jugador', 'player'), p('motivo', 'text', { default: 'Expulsado por el administrador' })], confirm: true },
].map((c, i) => ({ id: `d${i + 1}`, confirm: false, ...c }));

export function listCommands() {
  return db.data.settings.quickCommands || DEFAULT_COMMANDS;
}

const PLACEHOLDER = /\{([a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ]{1,24})\}/g;

/** Nombres de los huecos que aparecen en la plantilla, sin repetir. */
export function placeholders(template) {
  return [...new Set([...String(template).matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

function clean(cmd) {
  const label = String(cmd?.label || '').trim().slice(0, 40);
  let template = String(cmd?.template || '').trim().replace(/^\//, '');
  if (!label) throw new HttpError(400, 'Cada comando necesita un nombre');
  if (!template) throw new HttpError(400, `"${label}" no tiene comando`);
  if (template.length > 300 || /[\r\n]/.test(template)) throw new HttpError(400, `El comando de "${label}" es demasiado largo o tiene saltos de línea`);
  const given = new Map((Array.isArray(cmd.params) ? cmd.params : []).map((x) => [x?.name, x]));
  const params = placeholders(template).map((name) => {
    const x = given.get(name) || {};
    const type = PARAM_TYPES.includes(x.type) ? x.type : guessType(name);
    const options =
      type === 'select'
        ? (Array.isArray(x.options) ? x.options : String(x.options || '').split(','))
            .map((o) => String(o).trim())
            .filter(Boolean)
            .slice(0, 30)
        : [];
    if (type === 'select' && !options.length) throw new HttpError(400, `En "${label}", la lista de {${name}} no tiene opciones`);
    return { name, type, default: String(x.default ?? '').slice(0, 100), options };
  });
  return { id: /^[a-z0-9]{1,12}$/i.test(cmd.id || '') ? cmd.id : crypto.randomBytes(4).toString('hex'), label, template, params, confirm: Boolean(cmd.confirm) };
}

/** Tipo probable según el nombre del hueco, para que agregar comandos sea rápido. */
export function guessType(name) {
  const n = name.toLowerCase();
  if (/jugador|player|destino|objetivo|target/.test(n)) return 'player';
  if (/objeto|item|bloque|block/.test(n)) return 'item';
  if (/efecto|effect/.test(n)) return 'effect';
  if (/encant|enchant/.test(n)) return 'enchantment';
  if (/entidad|mob|entity|criatura/.test(n)) return 'entity';
  if (/modo|gamemode/.test(n)) return 'gamemode';
  if (/cantidad|numero|número|nivel|segundos|tiempo|niveles|amount|count/.test(n)) return 'number';
  return 'text';
}

export function saveCommands(list) {
  if (list === null) {
    db.data.settings.quickCommands = null; // vuelve a los de fábrica
  } else {
    if (!Array.isArray(list)) throw new HttpError(400, 'Lista inválida');
    if (list.length > 40) throw new HttpError(400, 'Máximo 40 comandos rápidos');
    const cleaned = list.map(clean);
    const ids = new Set();
    for (const c of cleaned) {
      while (ids.has(c.id)) c.id = crypto.randomBytes(4).toString('hex');
      ids.add(c.id);
    }
    db.data.settings.quickCommands = cleaned;
  }
  db.flush();
  return listCommands();
}
