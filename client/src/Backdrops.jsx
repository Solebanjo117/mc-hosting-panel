import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAppearance } from './appearance.js';

/**
 * Fondos vivos: el mapa de BlueMap de un servidor o la skin de un jugador girando en 3D.
 * Van detrás de todo, atenuados, y solo cuando el fondo elegido lo pide.
 */
export default function Backdrops({ servers }) {
  const a = useAppearance();
  if (a.background === 'mapa') return <MapBackdrop servers={servers} id={a.mapServer} />;
  if (a.background === 'skin' && a.skinName) return <SkinBackdrop name={a.skinName} />;
  return null;
}

function MapBackdrop({ servers, id }) {
  const server = servers.find((s) => s.id === id) || servers.find((s) => s.map?.enabled);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!server) return;
    api(`/servers/${server.id}/map`)
      .then((s) => setOk(Boolean(s.enabled)))
      .catch(() => {});
  }, [server?.id]);
  if (!server || !ok) return null;
  return (
    <div className="backdrop backdrop-map" aria-hidden="true">
      <iframe title="" src={`/api/servers/${server.id}/map/view/`} tabIndex={-1} />
    </div>
  );
}

/* ---- Skin en 3D con CSS: seis caras por cada parte del cuerpo, recortadas de la textura 64×64. ---- */

// [u, v, ancho, alto] en la textura, por cara. Formato moderno (64×64) con brazos de 4 de ancho.
const PARTS = [
  { name: 'head', w: 8, h: 8, d: 8, x: 0, y: 0, faces: { top: [8, 0], bottom: [16, 0], right: [0, 8], front: [8, 8], left: [16, 8], back: [24, 8] }, overlay: { top: [40, 0], bottom: [48, 0], right: [32, 8], front: [40, 8], left: [48, 8], back: [56, 8] } },
  { name: 'body', w: 8, h: 12, d: 4, x: 0, y: 8, faces: { top: [20, 16], bottom: [28, 16], right: [16, 20], front: [20, 20], left: [28, 20], back: [32, 20] } },
  { name: 'arm-r', w: 4, h: 12, d: 4, x: -6, y: 8, swing: 1, faces: { top: [44, 16], bottom: [48, 16], right: [40, 20], front: [44, 20], left: [48, 20], back: [52, 20] } },
  { name: 'arm-l', w: 4, h: 12, d: 4, x: 6, y: 8, swing: -1, faces: { top: [36, 48], bottom: [40, 48], right: [32, 52], front: [36, 52], left: [40, 52], back: [44, 52] } },
  { name: 'leg-r', w: 4, h: 12, d: 4, x: -2, y: 20, swing: -1, faces: { top: [4, 16], bottom: [8, 16], right: [0, 20], front: [4, 20], left: [8, 20], back: [12, 20] } },
  { name: 'leg-l', w: 4, h: 12, d: 4, x: 2, y: 20, swing: 1, faces: { top: [20, 48], bottom: [24, 48], right: [16, 52], front: [20, 52], left: [24, 52], back: [28, 52] } },
];

function Box({ part, src, S, overlay = false }) {
  const { w, h, d } = part;
  const faces = overlay ? part.overlay : part.faces;
  const grow = overlay ? 1.12 : 1;
  const sizes = { front: [w, h], back: [w, h], left: [d, h], right: [d, h], top: [w, d], bottom: [w, d] };
  const tf = {
    front: `translateZ(${(d / 2) * S * grow}px)`,
    back: `rotateY(180deg) translateZ(${(d / 2) * S * grow}px)`,
    right: `rotateY(-90deg) translateZ(${(w / 2) * S * grow}px)`,
    left: `rotateY(90deg) translateZ(${(w / 2) * S * grow}px)`,
    top: `rotateX(90deg) translateZ(${(h / 2) * S * grow}px)`,
    bottom: `rotateX(-90deg) translateZ(${(h / 2) * S * grow}px)`,
  };
  return (
    <div className="skin-box" style={{ width: w * S, height: h * S, transform: `translate3d(${part.x * S}px, ${part.y * S}px, 0)${overlay ? ` scale3d(${grow},${grow},${grow})` : ''}` }}>
      {Object.entries(faces).map(([face, [u, v]]) => {
        const [fw, fh] = sizes[face];
        return (
          <i
            key={face}
            className={`skin-face ${face}`}
            style={{
              width: fw * S,
              height: fh * S,
              marginLeft: -(fw * S) / 2,
              marginTop: -(fh * S) / 2,
              backgroundImage: `url("${src}")`,
              backgroundSize: `${64 * S}px ${64 * S}px`,
              backgroundPosition: `-${u * S}px -${v * S}px`,
              transform: tf[face],
            }}
          />
        );
      })}
    </div>
  );
}

export function SkinModel({ name, size = 10, className = '' }) {
  const src = useMemo(() => `https://mc-heads.net/skin/${encodeURIComponent(name)}`, [name]);
  return (
    <div className={`skin-stage ${className}`} style={{ width: 20 * size, height: 34 * size }} aria-hidden="true">
      <div className="skin-model">
        {PARTS.map((p) => (
          <div key={p.name} className={`skin-part ${p.swing ? `swing${p.swing > 0 ? '' : '-alt'}` : ''}`}>
            <Box part={p} src={src} S={size} />
            {p.overlay && <Box part={p} src={src} S={size} overlay />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkinBackdrop({ name }) {
  return (
    <div className="backdrop backdrop-skin" aria-hidden="true">
      <SkinModel name={name} size={11} />
    </div>
  );
}
