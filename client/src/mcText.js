/**
 * Texto con formato de Minecraft (códigos §) y colores ANSI de la consola → segmentos con estilo.
 */

export const MC_COLORS = {
  0: { hex: '#000000', name: 'Negro' },
  1: { hex: '#0000AA', name: 'Azul oscuro' },
  2: { hex: '#00AA00', name: 'Verde oscuro' },
  3: { hex: '#00AAAA', name: 'Aguamarina oscuro' },
  4: { hex: '#AA0000', name: 'Rojo oscuro' },
  5: { hex: '#AA00AA', name: 'Morado' },
  6: { hex: '#FFAA00', name: 'Dorado' },
  7: { hex: '#AAAAAA', name: 'Gris' },
  8: { hex: '#555555', name: 'Gris oscuro' },
  9: { hex: '#5555FF', name: 'Azul' },
  a: { hex: '#55FF55', name: 'Verde' },
  b: { hex: '#55FFFF', name: 'Aguamarina' },
  c: { hex: '#FF5555', name: 'Rojo' },
  d: { hex: '#FF55FF', name: 'Rosa' },
  e: { hex: '#FFFF55', name: 'Amarillo' },
  f: { hex: '#FFFFFF', name: 'Blanco' },
};

export const MC_FORMATS = {
  l: { name: 'Negrita', style: 'bold' },
  o: { name: 'Cursiva', style: 'italic' },
  n: { name: 'Subrayado', style: 'underline' },
  m: { name: 'Tachado', style: 'strike' },
  k: { name: 'Mágico: cada letra se vuelve un símbolo al azar que cambia sin parar (no parpadea; el texto deja de leerse)', style: 'obf' },
  r: { name: 'Quitar formato', style: 'reset' },
};

/** "§aHola §lmundo" → [{ text, color, bold, italic, underline, strike, obf }] */
export function parseMc(text, base = {}) {
  const out = [];
  let st = { ...base };
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, ...st });
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '§' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (MC_COLORS[code]) {
        flush();
        st = { ...base, color: MC_COLORS[code].hex }; // un color nuevo quita negrita, cursiva…
        i++;
        continue;
      }
      if (MC_FORMATS[code]) {
        flush();
        if (code === 'r') st = { ...base };
        else st = { ...st, [MC_FORMATS[code].style]: true };
        i++;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

const ANSI_COLORS = {
  30: '#555555',
  31: '#FF5555',
  32: '#55FF55',
  33: '#FFFF55',
  34: '#5555FF',
  35: '#FF55FF',
  36: '#55FFFF',
  37: '#E6E6E6',
  90: '#888888',
  91: '#FF7777',
  92: '#77FF77',
  93: '#FFFF77',
  94: '#7777FF',
  95: '#FF77FF',
  96: '#77FFFF',
  97: '#FFFFFF',
};

/** Línea de consola con códigos ANSI y/o §: primero ANSI, luego § dentro de cada tramo. */
export function parseConsole(line) {
  const out = [];
  let st = {};
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const push = (text) => {
    if (text) out.push(...parseMc(text, st));
  };
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) st = {};
      else if (c === 1) st = { ...st, bold: true };
      else if (c === 3) st = { ...st, italic: true };
      else if (c === 4) st = { ...st, underline: true };
      else if (c === 9) st = { ...st, strike: true };
      else if (c === 22) st = { ...st, bold: false };
      else if (c === 39) st = { ...st, color: undefined };
      else if (ANSI_COLORS[c]) st = { ...st, color: ANSI_COLORS[c] };
      else if (c === 38 && codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        st = { ...st, color: `rgb(${r},${g},${b})` };
        i += 4;
      } else if (c === 38 && codes[i + 1] === 5) i += 2;
    }
  }
  push(line.slice(last).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
  return out;
}

export function segStyle(s) {
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  return {
    color: s.color,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: deco || undefined,
  };
}

/** Texto visible sin códigos. */
export const plainMc = (text) => String(text).replace(/§[0-9a-fk-or]/gi, '');

// Caracteres que usa el juego para el texto mágico (§k): cambian cada fotograma.
const OBF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&?@*+=<>/\\{}[]~^';

/** Texto mágico: cada letra (no los espacios) se cambia por una al azar. */
export function scramble(text) {
  let out = '';
  for (const ch of text) out += ch === ' ' ? ' ' : OBF_CHARS[Math.floor(Math.random() * OBF_CHARS.length)];
  return out;
}
