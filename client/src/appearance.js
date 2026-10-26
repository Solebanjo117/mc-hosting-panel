import { useSyncExternalStore } from 'react';
import { api } from './api.js';

/**
 * Apariencia del panel. Se guarda en el servidor (se ve igual desde cualquier equipo) y se
 * conserva una copia en este navegador para aplicarla al instante al abrir, sin parpadeo.
 */
export const DEFAULTS = {
  theme: 'glass',
  background: 'aurora',
  animated: true,
  electric: true,
  accent: 'pasto',
  font: 'pixel',
  size: 'normal',
  glassOpacity: 38,
  glassBlur: 16,
  custom: { fit: 'cover', position: 'center', dim: 35, blur: 0, pixelated: false },
  imageAt: 0,
};

export const THEMES = [
  { id: 'glass', label: 'Cristal', text: 'Vidrio líquido: dobla la luz en los bordes, como las apps de Apple.' },
  { id: 'blocks', label: 'Bloques', text: 'Bisel duro y grano de píxel, como las pantallas del juego.' },
];

export const BACKGROUNDS = [
  { id: 'aurora', label: 'Aurora', text: 'Luz de pasto, prismarina y amatista.' },
  { id: 'cueva', label: 'Cueva', text: 'Deepslate con menas que laten.' },
  { id: 'atardecer', label: 'Atardecer', text: 'Nubes sobre el panorama de la portada.' },
  { id: 'fin', label: 'Fin', text: 'Estrellas que titilan y nebulosa morada.' },
  { id: 'nether', label: 'Nether', text: 'Roca oscura con brasas que suben.' },
  { id: 'oceano', label: 'Océano', text: 'Azul profundo con luz que ondula.' },
  { id: 'nevada', label: 'Nevada', text: 'Noche de invierno con nieve cayendo.' },
];

export const ACCENTS = [
  { id: 'pasto', label: 'Pasto', color: '#3fcf63' },
  { id: 'esmeralda', label: 'Esmeralda', color: '#39d353' },
  { id: 'prismarina', label: 'Prismarina', color: '#6fd6ea' },
  { id: 'diamante', label: 'Diamante', color: '#5fd6ff' },
  { id: 'amatista', label: 'Amatista', color: '#b48cff' },
  { id: 'oro', label: 'Oro', color: '#ffc757' },
  { id: 'cobre', label: 'Cobre', color: '#e8954e' },
  { id: 'redstone', label: 'Redstone', color: '#ef6a58' },
];

export const FONTS = [
  { id: 'pixel', label: 'Pixelada', text: 'La letra del juego, como en el logo.' },
  { id: 'clasica', label: 'Clásica', text: 'La letra normal de tu sistema.' },
];

export const SIZES = [
  { id: 'pequena', label: 'Pequeña' },
  { id: 'normal', label: 'Normal' },
  { id: 'grande', label: 'Grande' },
];

export const FITS = [
  { id: 'cover', label: 'Cubrir' },
  { id: 'contain', label: 'Completa' },
  { id: 'tile', label: 'Mosaico' },
];

export const POSITIONS = [
  { id: 'center', label: 'Centro' },
  { id: 'top', label: 'Arriba' },
  { id: 'bottom', label: 'Abajo' },
];

const KEY = 'mcp-appearance';
const merge = (base, patch) => ({ ...base, ...patch, custom: { ...base.custom, ...(patch?.custom || {}) } });

function load() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return merge(DEFAULTS, {});
  }
}

let current = load();
const listeners = new Set();

export const getAppearance = () => current;
export const imageUrl = (a = current) => (a.imageAt ? `/api/appearance/background?v=${a.imageAt}` : null);

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** La apariencia actual, reactiva. */
export function useAppearance() {
  return useSyncExternalStore(subscribe, getAppearance);
}

/** Lleva la apariencia al documento: atributos para el CSS y variables para los valores finos. */
export function applyAppearance(a) {
  const h = document.documentElement;
  h.dataset.theme = a.theme;
  h.dataset.bg = a.background;
  h.dataset.anim = a.animated ? 'on' : 'off';
  h.dataset.electric = a.electric ? 'on' : 'off';
  h.dataset.accent = a.accent;
  h.dataset.font = a.font;
  h.dataset.size = a.size;
  const st = h.style;
  st.setProperty('--glass-opacity', String(a.glassOpacity / 100));
  st.setProperty('--glass-blur-px', `${a.glassBlur}px`);
  const c = a.custom;
  const url = imageUrl(a);
  st.setProperty('--custom-bg', url ? `url("${url}")` : 'none');
  st.setProperty('--custom-fit', c.fit === 'tile' ? 'auto' : c.fit);
  st.setProperty('--custom-repeat', c.fit === 'tile' ? 'repeat' : 'no-repeat');
  st.setProperty('--custom-pos', c.position);
  st.setProperty('--custom-dim', String(c.dim / 100));
  st.setProperty('--custom-blur', `${c.blur}px`);
  st.setProperty('--custom-render', c.pixelated ? 'pixelated' : 'auto');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.theme === 'glass' ? '#0c0f15' : '#141518');
}

function setLocal(a) {
  current = a;
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* modo privado: solo dura esta visita */
  }
  applyAppearance(a);
  for (const fn of listeners) fn();
}

/** Trae la apariencia guardada en el servidor (al entrar). */
export async function loadAppearance() {
  try {
    setLocal(merge(DEFAULTS, await api('/appearance')));
  } catch {
    /* sin servidor: se queda la copia local */
  }
}

/** Aplica un cambio al momento y lo guarda en el servidor. */
export async function saveAppearance(patch) {
  const before = current;
  setLocal(merge(current, patch));
  try {
    setLocal(merge(DEFAULTS, await api('/system/appearance', { method: 'PUT', body: patch })));
  } catch (err) {
    setLocal(before);
    throw err;
  }
}

/** Sube la foto de fondo y la deja elegida. */
export async function uploadBackground(file) {
  const form = new FormData();
  form.append('image', file, file.name || 'fondo');
  const a = await api('/system/appearance/background', { method: 'PUT', form });
  setLocal(merge(DEFAULTS, a));
  await saveAppearance({ background: 'custom' });
}

export async function removeBackground() {
  setLocal(merge(DEFAULTS, await api('/system/appearance/background', { method: 'DELETE' })));
}

export async function resetAppearance() {
  const { imageAt, ...rest } = DEFAULTS;
  await saveAppearance(rest);
}
