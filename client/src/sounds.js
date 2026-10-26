import { getAppearance } from './appearance.js';

/**
 * Sonidos del panel, sintetizados con WebAudio (sin archivos): el "ding" de subir de nivel cuando
 * alguien entra, el cofre al terminar un respaldo y una fanfarria corta para un logro.
 * Se activan en Perfil y apariencia. El navegador solo deja sonar después de un clic en la página.
 */
let ctx = null;
const audio = () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

function tone(ac, freq, start, length, { type = 'square', gain = 0.08 } = {}) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + length);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + length + 0.05);
}

const SOUNDS = {
  join: (ac) => {
    tone(ac, 1046, 0, 0.12);
    tone(ac, 1568, 0.1, 0.25);
  },
  backup: (ac) => {
    tone(ac, 220, 0, 0.08, { type: 'triangle', gain: 0.12 });
    tone(ac, 330, 0.08, 0.12, { type: 'triangle', gain: 0.1 });
    tone(ac, 440, 0.18, 0.2, { type: 'triangle', gain: 0.08 });
  },
  achievement: (ac) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(ac, f, i * 0.09, 0.14));
    tone(ac, 1318, 0.4, 0.4, { gain: 0.07 });
  },
};

export function playSound(kind) {
  const prefs = getAppearance().sounds;
  if (!prefs?.enabled || !prefs[kind] || !SOUNDS[kind]) return;
  try {
    SOUNDS[kind](audio());
  } catch {
    /* sin audio */
  }
}
