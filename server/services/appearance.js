import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../lib/util.js';

/**
 * Apariencia del panel: tema, fondo, color de acento, letra, cristal y movimiento.
 * Se guarda en db.json para que el panel se vea igual desde cualquier equipo, y el fondo
 * personalizado (una foto que sube el usuario) en data/appearance/background.<ext>.
 */

export const DIR = path.join(DATA_DIR, 'appearance');

export const THEMES = ['glass', 'blocks'];
export const BACKGROUNDS = ['aurora', 'cueva', 'atardecer', 'fin', 'nether', 'oceano', 'nevada', 'custom'];
export const ACCENTS = ['pasto', 'esmeralda', 'prismarina', 'diamante', 'amatista', 'oro', 'cobre', 'redstone'];
export const FONTS = ['pixel', 'clasica'];
export const SIZES = ['pequena', 'normal', 'grande'];
export const FITS = ['cover', 'contain', 'tile'];
export const POSITIONS = ['center', 'top', 'bottom'];

export const DEFAULTS = {
  theme: 'glass',
  background: 'aurora',
  animated: true,
  electric: true,
  accent: 'pasto',
  font: 'pixel',
  size: 'normal',
  glassOpacity: 38, // 0–90: qué tan opaco es el cristal
  glassBlur: 16, // 0–30 px
  custom: { fit: 'cover', position: 'center', dim: 35, blur: 0, pixelated: false },
  imageAt: 0, // marca de tiempo de la foto subida (0 = no hay)
};

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

export function getAppearance() {
  const saved = db.data.settings.appearance || {};
  return { ...DEFAULTS, ...saved, custom: { ...DEFAULTS.custom, ...(saved.custom || {}) }, imageAt: imageFile() ? saved.imageAt || 1 : 0 };
}

/** Aplica un cambio parcial; lo que no es válido se rechaza con 400. */
export function setAppearance(patch) {
  if (!patch || typeof patch !== 'object') throw new HttpError(400, 'Faltan los datos de apariencia');
  const cur = getAppearance();
  const next = { ...cur };
  const bad = (k) => {
    throw new HttpError(400, `Valor inválido para ${k}`);
  };
  if (patch.theme !== undefined) next.theme = THEMES.includes(patch.theme) ? patch.theme : bad('theme');
  if (patch.background !== undefined) next.background = BACKGROUNDS.includes(patch.background) ? patch.background : bad('background');
  if (patch.accent !== undefined) next.accent = ACCENTS.includes(patch.accent) ? patch.accent : bad('accent');
  if (patch.font !== undefined) next.font = FONTS.includes(patch.font) ? patch.font : bad('font');
  if (patch.size !== undefined) next.size = SIZES.includes(patch.size) ? patch.size : bad('size');
  if (patch.animated !== undefined) next.animated = Boolean(patch.animated);
  if (patch.electric !== undefined) next.electric = Boolean(patch.electric);
  if (patch.glassOpacity !== undefined) next.glassOpacity = clamp(patch.glassOpacity, 0, 90, cur.glassOpacity);
  if (patch.glassBlur !== undefined) next.glassBlur = clamp(patch.glassBlur, 0, 30, cur.glassBlur);
  if (patch.custom !== undefined) {
    const c = patch.custom && typeof patch.custom === 'object' ? patch.custom : bad('custom');
    next.custom = {
      fit: pick(c.fit ?? cur.custom.fit, FITS, cur.custom.fit),
      position: pick(c.position ?? cur.custom.position, POSITIONS, cur.custom.position),
      dim: clamp(c.dim ?? cur.custom.dim, 0, 80, cur.custom.dim),
      blur: clamp(c.blur ?? cur.custom.blur, 0, 30, cur.custom.blur),
      pixelated: Boolean(c.pixelated ?? cur.custom.pixelated),
    };
  }
  if (next.background === 'custom' && !imageFile()) throw new HttpError(400, 'Sube una foto antes de elegir el fondo personalizado');
  const { imageAt, ...toSave } = next;
  db.data.settings.appearance = { ...toSave, imageAt: cur.imageAt };
  db.save();
  return getAppearance();
}

/** Ruta de la foto subida, o null. */
export function imageFile() {
  try {
    const f = fs.readdirSync(DIR).find((n) => /^background\.(png|jpg|webp|gif)$/.test(n));
    return f ? path.join(DIR, f) : null;
  } catch {
    return null;
  }
}

export function imageMime(file) {
  const ext = path.extname(file).slice(1);
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
}

/** Reconoce el formato por los primeros bytes; el nombre o el tipo que manda el navegador no se usan. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function saveImage(buf) {
  if (!buf || !buf.length) throw new HttpError(400, 'No llegó ninguna foto');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'La foto es demasiado grande (máximo 12 MB)');
  const mime = sniff(buf);
  if (!mime) throw new HttpError(400, 'Solo se admiten fotos PNG, JPG, WebP o GIF');
  fs.mkdirSync(DIR, { recursive: true });
  removeImage({ keepChoice: true });
  fs.writeFileSync(path.join(DIR, `background.${EXT[mime]}`), buf);
  db.data.settings.appearance = { ...(db.data.settings.appearance || {}), imageAt: Date.now() };
  db.save();
  return getAppearance();
}

export function removeImage({ keepChoice = false } = {}) {
  const f = imageFile();
  if (f) fs.rmSync(f, { force: true });
  const a = db.data.settings.appearance || {};
  db.data.settings.appearance = { ...a, imageAt: 0, background: !keepChoice && a.background === 'custom' ? DEFAULTS.background : a.background };
  db.save();
  return getAppearance();
}
