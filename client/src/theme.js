/**
 * Apariencia del panel. Se guarda por navegador.
 *  - cristal: superficies translúcidas con desenfoque y bordes de luz (por defecto).
 *  - bloques: el bisel duro y el grano de píxel de las pantallas del juego.
 */
const KEY = 'mcp-theme';
export const THEMES = [
  { id: 'glass', label: 'Cristal', text: 'Translúcido y suave, al estilo de las apps de Apple.' },
  { id: 'blocks', label: 'Bloques', text: 'Bisel duro y grano de píxel, como las pantallas del juego.' },
];

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
