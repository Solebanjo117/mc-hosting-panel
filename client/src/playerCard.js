/**
 * Dibuja la tarjeta de un jugador (cara, nombre y estadísticas) en un canvas y la descarga como PNG.
 * Si la cara no se puede dibujar (sin internet o sin CORS), se usa la inicial.
 */
const fmt = {
  duration: (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  },
  num: (n) => new Intl.NumberFormat('es-MX').format(n || 0),
};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function downloadPlayerCard({ server, player, accent = '#3fcf63' }) {
  const W = 720;
  const H = 400;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Fondo
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0f1a2b');
  g.addColorStop(1, '#101a14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(80, 60, 10, 80, 60, 420);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Tarjeta
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(24, 24, W - 48, H - 48, 22);
  ctx.fill();
  ctx.stroke();
  // Cara
  const name = player.name || player.uuid || '?';
  const face = await loadImage(`https://mc-heads.net/avatar/${encodeURIComponent(player.uuid || name)}/96`);
  ctx.imageSmoothingEnabled = false;
  if (face) {
    try {
      ctx.drawImage(face, 56, 56, 96, 96);
    } catch {
      /* lienzo contaminado */
    }
  } else {
    ctx.fillStyle = '#3d3f45';
    ctx.fillRect(56, 56, 96, 96);
    ctx.fillStyle = '#f2f3f6';
    ctx.font = 'bold 56px "Pixelify Sans", system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(name[0].toUpperCase(), 104, 128);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2f3f6';
  ctx.font = '500 40px "Pixelify Sans", system-ui';
  ctx.fillText(name, 176, 100);
  ctx.fillStyle = '#b6bcc8';
  ctx.font = '20px "Pixelify Sans", system-ui';
  ctx.fillText(`Jugador de ${server.name}`, 176, 134);
  // Estadísticas
  const stats = [
    ['Tiempo jugado', fmt.duration(player.playTime || 0)],
    ['Bloques minados', fmt.num(player.blocksMined)],
    ['Distancia', player.distance >= 1000 ? `${(player.distance / 1000).toFixed(1)} km` : `${fmt.num(player.distance)} m`],
    ['Mobs derrotados', fmt.num(player.mobKills)],
    ['Muertes', fmt.num(player.deaths)],
    ['Sesiones', fmt.num(player.sessions)],
  ];
  stats.forEach(([label, value], i) => {
    const x = 56 + (i % 3) * 215;
    const y = 210 + Math.floor(i / 3) * 80;
    ctx.fillStyle = '#979eac';
    ctx.font = '16px "Pixelify Sans", system-ui';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#f2f3f6';
    ctx.font = '600 28px "Pixelify Sans", system-ui';
    ctx.fillText(value, x, y + 32);
  });
  ctx.fillStyle = accent;
  ctx.fillRect(56, H - 60, 120, 4);
  ctx.fillStyle = '#979eac';
  ctx.font = '14px "Pixelify Sans", system-ui';
  ctx.fillText(`MC Hosting Panel · ${new Date().toLocaleDateString('es-MX')}`, 56, H - 36);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${server.name}.png`.replace(/[^\w.-]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
