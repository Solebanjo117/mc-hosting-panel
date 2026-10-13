import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { MC_COLORS, MC_FORMATS, parseMc, plainMc, scramble, segStyle } from '../../mcText.js';
import { useAction, useToast } from '../../ui.jsx';
import { ServerIcon } from '../Home.jsx';
import IconCropper, { readImage } from './IconCropper.jsx';

const MAX_VISIBLE = 45; // aprox. lo que cabe en una línea de la lista de servidores

/** Texto mágico (§k) como en el juego: letras al azar que cambian sin parar. */
function Obfuscated({ text, style }) {
  const [shown, setShown] = useState(() => scramble(text));
  useEffect(() => {
    setShown(scramble(text));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setShown(scramble(text)), 70);
    return () => clearInterval(t);
  }, [text]);
  return (
    <span style={style} title={`Texto mágico: en el juego se ve así. Debajo dice "${text}"`}>
      {shown}
    </span>
  );
}

function McLine({ text }) {
  return (
    <>
      {parseMc(text, { color: '#AAAAAA' }).map((s, i) =>
        s.obf ? (
          <Obfuscated key={i} text={s.text} style={segStyle(s)} />
        ) : (
          <span key={i} style={segStyle(s)}>
            {s.text}
          </span>
        )
      )}
    </>
  );
}

/** ¿Todas las letras visibles de la línea son texto mágico? */
const allMagic = (text) => {
  const segs = parseMc(text).filter((x) => x.text.trim());
  return segs.length > 0 && segs.every((x) => x.obf);
};

/** Recorta al centro y escala a 64×64. Si la imagen es chica (pixel art), sin suavizar. */
export default function AppearanceEditor({ server, running }) {
  const [lines, setLines] = useState(null);
  const [saved, setSaved] = useState(null);
  const [maxPlayers, setMaxPlayers] = useState('20');
  const [focus, setFocus] = useState(0);
  const [preview, setPreview] = useState(null); // ícono nuevo sin guardar
  const [cropping, setCropping] = useState(null); // foto elegida, antes de recortar
  const refs = [useRef(null), useRef(null)];
  const fileRef = useRef(null);
  const caret = useRef(null); // { i, pos } para dejar el cursor después del código insertado
  useLayoutEffect(() => {
    if (!caret.current) return;
    const { i, pos } = caret.current;
    caret.current = null;
    const el = refs[i].current;
    el?.focus();
    el?.setSelectionRange(pos, pos);
  });
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => {
    api(`/servers/${server.id}/properties`).then((p) => {
      const [a = '', b = ''] = String(p.motd ?? 'A Minecraft Server').split('\n');
      setLines([a, b]);
      setSaved(`${a}\n${b}`);
      setMaxPlayers(p['max-players'] || '20');
    });
  }, [server.id]);

  if (!lines) return null;

  const insert = (code) => {
    const i = focus;
    const el = refs[i].current;
    const text = lines[i];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = [...lines];
    // Si hay texto seleccionado, se pinta solo ese tramo y luego se vuelve al formato normal.
    next[i] = start !== end ? `${text.slice(0, start)}§${code}${text.slice(start, end)}§r${text.slice(end)}` : `${text.slice(0, start)}§${code}${text.slice(end)}`;
    caret.current = { i, pos: start + 2 + (start !== end ? end - start + 2 : 0) };
    setLines(next);
  };

  const motd = lines[1] ? `${lines[0]}\n${lines[1]}` : lines[0];
  const dirty = `${lines[0]}\n${lines[1]}` !== saved;

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Cómo se ve en la lista de servidores</h2>

      <div className="mc-list" aria-label="Vista previa">
        {preview ? <img src={preview} width={64} height={64} alt="" className="server-icon" /> : <ServerIcon server={server} size={64} />}
        <div className="mc-list-text">
          <div className="mc-list-top">
            <span className="mc-name">{server.name}</span>
            <span className="mc-players">
              0/{maxPlayers}
              <span className="mc-ping" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
          </div>
          <div>
            <McLine text={lines[0]} />
          </div>
          <div>
            <McLine text={lines[1]} />
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: '0.5rem' }}>
        <div className="mc-toolbar" role="toolbar" aria-label="Colores y formato">
          {Object.entries(MC_COLORS).map(([code, c]) => (
            <button key={code} type="button" className="mc-swatch" style={{ background: c.hex }} title={`${c.name} (§${code})`} aria-label={c.name} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(code)} />
          ))}
          <span className="mc-sep" />
          {Object.entries(MC_FORMATS).map(([code, f]) => (
            <button
              key={code}
              type="button"
              className="btn-sm btn-ghost mc-fmt"
              title={`${f.name} (§${code})`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(code)}
              style={code === 'l' ? { fontWeight: 700 } : code === 'o' ? { fontStyle: 'italic' } : code === 'n' ? { textDecoration: 'underline' } : code === 'm' ? { textDecoration: 'line-through' } : undefined}
            >
              {code === 'l' ? 'N' : code === 'o' ? 'C' : code === 'n' ? 'S' : code === 'm' ? 'T' : code === 'k' ? 'Mágico' : 'Normal'}
            </button>
          ))}
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          Selecciona texto y elige un color o formato, o pon el cursor y elige para lo que escribas después.
        </p>
        {[0, 1].map((i) => {
          const visible = plainMc(lines[i]).length;
          return (
            <label className="field" key={i}>
              <span>
                Línea {i + 1}
                {visible > MAX_VISIBLE && <span className="faint"> · puede no caber completa ({visible} letras)</span>}
                {allMagic(lines[i]) && <span style={{ color: 'var(--gold)' }}> · toda la línea es texto mágico: nadie podrá leerla</span>}
              </span>
              <input
                ref={refs[i]}
                className="mono"
                value={lines[i]}
                onFocus={() => setFocus(i)}
                onChange={(e) => setLines((l) => l.map((x, j) => (j === i ? e.target.value.replace(/\n/g, '') : x)))}
                maxLength={120}
                spellCheck={false}
              />
            </label>
          );
        })}
      </div>

      <div className="row">
        <button
          className="btn-go"
          disabled={busy || !dirty}
          onClick={() =>
            run(async () => {
              await api(`/servers/${server.id}/properties`, { method: 'PUT', body: { motd } });
              setSaved(`${lines[0]}\n${lines[1]}`);
            }, running ? 'Mensaje guardado. Se verá después de reiniciar el servidor.' : 'Mensaje guardado')
          }
        >
          Guardar mensaje
        </button>
        <span className="grow" />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            try {
              setCropping(await readImage(f));
            } catch (err) {
              toast(err.message, 'error');
            }
          }}
        />
        {preview ? (
          <>
            <button onClick={() => setPreview(null)}>Cancelar ícono</button>
            <button
              className="btn-go"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/servers/${server.id}/icon`, { method: 'PUT', body: { png: preview } });
                  setPreview(null);
                }, running ? 'Ícono guardado. Se verá después de reiniciar el servidor.' : 'Ícono guardado')
              }
            >
              Guardar ícono
            </button>
          </>
        ) : (
          <>
            <button onClick={() => fileRef.current.click()}>Cambiar ícono</button>
            {server.iconAt ? (
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => api(`/servers/${server.id}/icon`, { method: 'PUT', body: { remove: true } }), 'Ícono quitado')}>
                Quitar ícono
              </button>
            ) : null}
          </>
        )}
      </div>
      {cropping && (
        <IconCropper
          image={cropping}
          onCancel={() => setCropping(null)}
          onDone={(png) => {
            setPreview(png);
            setCropping(null);
          }}
        />
      )}
      <p className="faint small" style={{ margin: 0 }}>
        Eliges qué parte de la foto usar y el panel la ajusta a 64×64. Cualquier imagen sirve (PNG, JPG, GIF…). Los cambios se ven en Minecraft al reiniciar el
        servidor.
      </p>
    </section>
  );
}
