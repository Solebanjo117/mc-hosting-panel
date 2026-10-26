/**
 * Apariencia del panel. Se guarda por navegador.
 *  - cristal: superficies translúcidas con desenfoque y bordes de luz (por defecto).
 *  - bloques: el bisel duro y el grano de píxel de las pantallas del juego.
 */
const KEY = 'mcp-theme';
const BG_KEY = 'mcp-bg';
export const THEMES = [
  { id: 'glass', label: 'Cristal', text: 'Vidrio líquido: dobla la luz en los bordes, como las apps de Apple.' },
  { id: 'blocks', label: 'Bloques', text: 'Bisel duro y grano de píxel, como las pantallas del juego.' },
];

/** Fondos del tema Cristal. */
export const BACKGROUNDS = [
  { id: 'aurora', label: 'Aurora', text: 'Luz de pasto, prismarina y amatista.' },
  { id: 'cueva', label: 'Cueva', text: 'Deepslate con menas que brillan.' },
  { id: 'atardecer', label: 'Atardecer', text: 'El panorama de la portada al caer la noche.' },
  { id: 'fin', label: 'Fin', text: 'Estrellas de píxel y nebulosa morada.' },
  { id: 'nether', label: 'Nether', text: 'Roca oscura con lava al fondo.' },
  { id: 'oceano', label: 'Océano', text: 'Azul profundo con luz que ondula.' },
  { id: 'nevada', label: 'Nevada', text: 'Noche de invierno con nieve cayendo.' },
];
const ANIM_KEY = 'mcp-anim';

/** ¿El fondo se mueve? (apagado también si el sistema pide reducir movimiento). */
export function getAnimated() {
  try {
    return localStorage.getItem(ANIM_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function applyAnimated(on) {
  document.documentElement.dataset.anim = on ? 'on' : 'off';
}

export function setAnimated(on) {
  try {
    localStorage.setItem(ANIM_KEY, on ? 'on' : 'off');
  } catch {
    /* modo privado */
  }
  applyAnimated(on);
}

export function getBackground() {
  try {
    const b = localStorage.getItem(BG_KEY);
    return BACKGROUNDS.some((x) => x.id === b) ? b : 'aurora';
  } catch {
    return 'aurora';
  }
}

export function applyBackground(id) {
  document.documentElement.dataset.bg = id;
}

export function setBackground(id) {
  try {
    localStorage.setItem(BG_KEY, id);
  } catch {
    /* modo privado */
  }
  applyBackground(id);
}

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? t : 'glass';
  } catch {
    return 'glass';
  }
}

export function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', id === 'glass' ? '#0c0f15' : '#141518');
}

export function setTheme(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* modo privado: solo dura esta visita */
  }
  applyTheme(id);
}
