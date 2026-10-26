import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GrassBlock, usePageTitle } from '../ui.jsx';
import { BACKGROUNDS, getAnimated, getBackground, getTheme, setAnimated, setBackground, setTheme, THEMES } from '../theme.js';

/**
 * Perfil y apariencia: tema (Cristal o Bloques), fondo del tema Cristal con vista previa,
 * y si el fondo se mueve. Todo se guarda en este navegador.
 */
export default function Appearance({ username }) {
  usePageTitle('Perfil y apariencia');
  const [theme, setThemeState] = useState(getTheme);
  const [bg, setBgState] = useState(getBackground);
  const [anim, setAnimState] = useState(getAnimated);
  const choose = (id) => {
    setTheme(id);
    setThemeState(id);
  };
  const chooseBg = (id) => {
    setBackground(id);
    setBgState(id);
  };
  const toggleAnim = (on) => {
    setAnimated(on);
    setAnimState(on);
  };

  return (
    <div className="page stack" style={{ gap: '1.75rem', maxWidth: 900 }}>
      <header className="profile-head">
        <GrassBlock size={48} />
        <div>
          <h1>{username}</h1>
          <p className="muted small">
            Administrador del panel. Estas preferencias se guardan en este navegador; cada equipo puede tener las suyas.{' '}
            <Link to="/ajustes">Cambiar la contraseña</Link>.
          </p>
        </div>
      </header>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Tema</h2>
        <div className="type-grid" role="radiogroup" aria-label="Tema">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`type-option${theme === t.id ? ' on' : ''}`} onClick={() => choose(t.id)}>
              <strong>{t.label}</strong>
              <span>{t.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Fondo</h2>
        {theme !== 'glass' && <p className="muted small">El fondo se usa con el tema Cristal. Bloques tiene su propia piedra.</p>}
        <div className="bg-grid" role="radiogroup" aria-label="Fondo">
          {BACKGROUNDS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} className={`bg-option${bg === b.id ? ' on' : ''}`} onClick={() => chooseBg(b.id)}>
              <span className="bg-preview" data-bg={b.id} aria-hidden="true" />
              <strong>{b.label}</strong>
              <span>{b.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Movimiento</h2>
        <label className="check">
          <input type="checkbox" checked={anim} onChange={(e) => toggleAnim(e.target.checked)} />
          <span>
            Fondo animado: luz que se desplaza, estrellas que titilan, nieve o brasas. Se apaga solo si tu sistema pide reducir el movimiento; desactívalo
            también si tu PC va justa.
          </span>
        </label>
      </section>
    </div>
  );
}
