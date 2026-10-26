import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GrassBlock, useAction, usePageTitle, useToast } from '../ui.jsx';
import {
  ACCENTS,
  BACKGROUNDS,
  FITS,
  FONTS,
  POSITIONS,
  SIZES,
  THEMES,
  imageUrl,
  removeBackground,
  resetAppearance,
  saveAppearance,
  uploadBackground,
  useAppearance,
} from '../appearance.js';

/**
 * Perfil y apariencia: todo lo que cambia cómo se ve el panel. Se guarda en el servidor,
 * así que se ve igual desde cualquier equipo.
 */
export default function Appearance({ username }) {
  usePageTitle('Perfil y apariencia');
  const a = useAppearance();
  const toast = useToast();
  const [run, busy] = useAction();
  const save = (patch) => run(() => saveAppearance(patch));
  const glass = a.theme === 'glass';

  return (
    <div className="page stack" style={{ gap: '1.75rem', maxWidth: 960 }}>
      <header className="profile-head">
        <GrassBlock size={48} />
        <div className="grow">
          <h1>{username}</h1>
          <p className="muted small">
            Administrador del panel. Lo que elijas aquí se guarda en el panel y se ve igual desde cualquier equipo.{' '}
            <Link to="/ajustes">Cambiar la contraseña</Link>.
          </p>
        </div>
        <button type="button" className="btn-sm" disabled={busy} onClick={() => run(() => resetAppearance(), 'Apariencia restablecida')}>
          Restablecer todo
        </button>
      </header>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Tema</h2>
        <Radios name="Tema" items={THEMES} value={a.theme} onChange={(theme) => save({ theme })} />
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Fondo</h2>
        <div className="bg-grid" role="radiogroup" aria-label="Fondo">
          {BACKGROUNDS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={a.background === b.id} className={`bg-option${a.background === b.id ? ' on' : ''}`} onClick={() => save({ background: b.id })}>
              <span className="bg-preview" data-bg={b.id} aria-hidden="true" />
              <strong>{b.label}</strong>
              <span>{b.text}</span>
            </button>
          ))}
          <CustomBackground a={a} busy={busy} run={run} toast={toast} />
        </div>
        {a.background === 'custom' && (
          <div className="stack" style={{ gap: '0.9rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)' }}>
            <h3>Tu foto</h3>
            <div className="grid-2">
              <div className="field">
                <label>Ajuste</label>
                <Segmented items={FITS} value={a.custom.fit} onChange={(fit) => save({ custom: { fit } })} label="Ajuste de la foto" />
              </div>
              <div className="field">
                <label>Posición</label>
                <Segmented items={POSITIONS} value={a.custom.position} onChange={(position) => save({ custom: { position } })} label="Posición de la foto" />
              </div>
              <Slider label="Oscurecer" value={a.custom.dim} min={0} max={80} unit="%" onChange={(dim) => save({ custom: { dim } })} />
              <Slider label="Desenfoque" value={a.custom.blur} min={0} max={30} unit=" px" onChange={(blur) => save({ custom: { blur } })} />
            </div>
            <label className="check">
              <input type="checkbox" checked={a.custom.pixelated} onChange={(e) => save({ custom: { pixelated: e.target.checked } })} />
              <span>Pixelar al ampliar: los bloques de una captura del juego se ven nítidos, sin suavizar.</span>
            </label>
          </div>
        )}
        {!glass && a.background !== 'custom' && <p className="muted small">Los fondos de luz son del tema Cristal. Con Bloques puedes usar tu propia foto.</p>}
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Color de acento</h2>
        <p className="muted small">El color de los botones principales, lo seleccionado y la barra de progreso.</p>
        <div className="swatches" role="radiogroup" aria-label="Color de acento">
          {ACCENTS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={a.accent === c.id} className={`swatch${a.accent === c.id ? ' on' : ''}`} style={{ '--swatch': c.color }} onClick={() => save({ accent: c.id })}>
              <i aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Letra</h2>
        <Radios name="Letra" items={FONTS} value={a.font} onChange={(font) => save({ font })} />
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Tamaño</label>
          <Segmented items={SIZES} value={a.size} onChange={(size) => save({ size })} label="Tamaño de letra" />
        </div>
      </section>

      {glass && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Cristal</h2>
          <div className="grid-2">
            <Slider label="Opacidad del vidrio" value={a.glassOpacity} min={0} max={90} unit="%" onChange={(glassOpacity) => save({ glassOpacity })} />
            <Slider label="Desenfoque del vidrio" value={a.glassBlur} min={0} max={30} unit=" px" onChange={(glassBlur) => save({ glassBlur })} />
          </div>
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Movimiento</h2>
        <label className="check">
          <input type="checkbox" checked={a.animated} onChange={(e) => save({ animated: e.target.checked })} />
          <span>Fondo animado: luz que se desplaza, estrellas que titilan, nieve o brasas. Se detiene solo si tu sistema pide reducir el movimiento.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={a.electric} onChange={(e) => save({ electric: e.target.checked })} />
          <span>Borde eléctrico en los servidores: chispas del color de su estado. Si lo apagas, vuelve la lámpara de redstone.</span>
        </label>
      </section>
    </div>
  );
}

/** La tarjeta "Tu foto": sube una imagen o cambia la que hay. */
function CustomBackground({ a, busy, run, toast }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const url = imageUrl(a);
  const pick = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Solo fotos PNG, JPG, WebP o GIF', 'error');
    if (file.size > 12 * 1024 * 1024) return toast('La foto pesa más de 12 MB', 'error');
    run(() => uploadBackground(file), 'Foto de fondo guardada');
  };
  return (
    <div
      className={`bg-option bg-custom${a.background === 'custom' ? ' on' : ''}${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {url ? (
        <button type="button" role="radio" aria-checked={a.background === 'custom'} className="bg-preview-btn" disabled={busy} onClick={() => run(() => saveAppearance({ background: 'custom' }))} aria-label="Usar tu foto de fondo">
          <span className="bg-preview" data-bg="custom" aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="bg-preview bg-drop" disabled={busy} onClick={() => input.current?.click()}>
          Elegir foto…
        </button>
      )}
      <strong>Tu foto</strong>
      <span>{url ? 'PNG, JPG, WebP o GIF; también puedes arrastrarla aquí.' : 'Sube una imagen o arrástrala aquí (hasta 12 MB).'}</span>
      {url && (
        <span className="row" style={{ gap: '0.3rem' }}>
          <button type="button" className="btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            Cambiar
          </button>
          <button type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => run(() => removeBackground(), 'Foto quitada')}>
            Quitar
          </button>
        </span>
      )}
    </div>
  );
}

function Radios({ name, items, value, onChange }) {
  return (
    <div className="type-grid" role="radiogroup" aria-label={name}>
      {items.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={value === t.id} className={`type-option${value === t.id ? ' on' : ''}`} onClick={() => onChange(t.id)}>
          <strong>{t.label}</strong>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

function Segmented({ items, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button key={i.id} type="button" role="radio" aria-checked={value === i.id} className={value === i.id ? 'on' : ''} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Deslizador que guarda al soltar (no en cada píxel) pero se ve al momento. */
function Slider({ label, value, min, max, unit, onChange }) {
  const [v, setV] = useState(value);
  const [touched, setTouched] = useState(false);
  const shown = touched ? v : value;
  return (
    <label className="field">
      <span>
        {label}: {shown}
        {unit}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        onChange={(e) => {
          setTouched(true);
          setV(Number(e.target.value));
        }}
        onMouseUp={() => {
          setTouched(false);
          onChange(v);
        }}
        onTouchEnd={() => {
          setTouched(false);
          onChange(v);
        }}
        onKeyUp={() => {
          setTouched(false);
          onChange(v);
        }}
        style={{ padding: 0, minHeight: 28 }}
      />
    </label>
  );
}
