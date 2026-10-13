import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../ui.jsx';

const VIEW = 256; // tamaño del recuadro en pantalla
const OUT = 64; // tamaño que pide Minecraft

/** Lee un archivo como data: (la política de seguridad del panel no permite imágenes blob:). */
export function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Ese archivo no es una imagen que el navegador pueda abrir'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Elige qué parte de la foto será el ícono: arrastra para mover, usa el zoom y la vista previa
 * muestra cómo queda en 64×64.
 */
export default function IconCropper({ image, onCancel, onDone }) {
  const cover = Math.max(VIEW / image.width, VIEW / image.height);
  const small = Math.max(image.width, image.height) <= 64;
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState(() => ({ x: (VIEW - image.width * cover) / 2, y: (VIEW - image.height * cover) / 2 }));
  const [pixel, setPixel] = useState(small);
  const viewRef = useRef(null);
  const previewRef = useRef(null);
  const drag = useRef(null);

  const scale = cover * zoom;
  const w = image.width * scale;
  const h = image.height * scale;
  // La foto siempre cubre todo el recuadro (sin bordes vacíos).
  const clamp = (p, ww = w, hh = h) => ({ x: Math.min(0, Math.max(VIEW - ww, p.x)), y: Math.min(0, Math.max(VIEW - hh, p.y)) });

  const draw = (canvas, size) => {
    const ctx = canvas.getContext('2d');
    const k = size / VIEW;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = !pixel;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, pos.x * k, pos.y * k, w * k, h * k);
  };

  useEffect(() => {
    if (viewRef.current) draw(viewRef.current, VIEW);
    if (previewRef.current) draw(previewRef.current, OUT);
  });

  const setZoomAround = (z) => {
    const nz = Math.min(5, Math.max(1, z));
    const ns = cover * nz;
    // Acerca respecto al centro del recuadro.
    const cx = (VIEW / 2 - pos.x) / scale;
    const cy = (VIEW / 2 - pos.y) / scale;
    setZoom(nz);
    setPos(clamp({ x: VIEW / 2 - cx * ns, y: VIEW / 2 - cy * ns }, image.width * ns, image.height * ns));
  };

  const finish = () => {
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    draw(c, OUT);
    onDone(c.toDataURL('image/png'));
  };

  return (
    <Modal title="Elige la parte de la foto" onClose={onCancel}>
      <div className="cropper">
        <canvas
          ref={viewRef}
          width={VIEW}
          height={VIEW}
          className="crop-view"
          aria-label="Arrastra para mover la foto"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, start: pos };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            const f = VIEW / r.width; // por si el recuadro se ve más chico en el celular
            setPos(clamp({ x: drag.current.start.x + (e.clientX - drag.current.x) * f, y: drag.current.start.y + (e.clientY - drag.current.y) * f }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoomAround(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
        />
        <div className="stack" style={{ gap: '0.75rem', alignContent: 'start' }}>
          <div>
            <div className="faint small">Así se verá</div>
            <canvas ref={previewRef} width={OUT} height={OUT} className="crop-preview" />
          </div>
          <label className="field">
            <span>Zoom</span>
            <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} />
          </label>
          <label className="row small" style={{ gap: '0.4rem' }}>
            <input type="checkbox" checked={pixel} onChange={(e) => setPixel(e.target.checked)} />
            Pixel art (bordes nítidos)
          </label>
        </div>
      </div>
      <p className="faint small">Arrastra la foto para moverla y usa el zoom (o la rueda del mouse) para acercarla.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>Cancelar</button>
        <button className="btn-go" onClick={finish}>
          Usar esta parte
        </button>
      </div>
    </Modal>
  );
}
