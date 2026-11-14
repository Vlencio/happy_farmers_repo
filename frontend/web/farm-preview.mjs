import { BOUNDARY_STYLE, satelliteTileUrl } from './imagery.mjs';
import { planPreview, previewDimensions } from './preview-layout.mjs';

export async function renderFarmPreview(farm, dimensions, signal) {
  const plan = planPreview(farm.geojson, dimensions.width, dimensions.height, dimensions.scale);
  const canvas = document.createElement('canvas');
  canvas.width = plan.width; canvas.height = plan.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#e7ecdd'; ctx.fillRect(0, 0, plan.width, plan.height);
  const tileSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  const loaded = await Promise.all(plan.tiles.map(async (tile) => {
    let image;
    try {
      const response = await fetch(satelliteTileUrl(tile), { signal: tileSignal, mode: 'cors' });
      if (!response.ok) return false;
      image = await createImageBitmap(await response.blob());
      signal.throwIfAborted();
      ctx.drawImage(image, tile.left, tile.top, 256, 256);
      return true;
    } catch (error) {
      if (signal.aborted) throw error;
      return false;
    } finally { image?.close(); }
  }));
  signal.throwIfAborted();
  const complete = loaded.every(Boolean), available = loaded.some(Boolean);
  // Even-odd fill keeps excluded inner areas transparent, regardless of ring winding.
  for (const polygon of plan.rings) {
    ctx.beginPath();
    for (const ring of polygon) {
      ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
    }
    ctx.fillStyle = available ? 'rgba(187, 221, 130, 0.22)' : '#d9e7b7';
    ctx.fill('evenodd');
    ctx.strokeStyle = available ? BOUNDARY_STYLE.color : '#527a42';
    ctx.lineWidth = BOUNDARY_STYLE.weight * plan.scale;
    ctx.lineJoin = 'round'; ctx.stroke();
  }
  return {
    width: plan.width, height: plan.height,
    rgba: new Uint8Array(ctx.getImageData(0, 0, plan.width, plan.height).data.buffer),
    note: complete ? '' : available
      ? 'Parte da imagem de satélite não carregou. O contorno está completo.'
      : 'Imagem de satélite indisponível. O contorno continua visível.',
  };
}

// Keep only the current field/size. A slow response must never restore an old field.
export function createFarmPreview(onFrame, { render = renderFarmPreview, pixelRatio = () => window.devicePixelRatio || 1, debounce = 120 } = {}) {
  let farm = null, size = null, timer, controller, generation = 0;
  function refresh() {
    const current = ++generation;
    clearTimeout(timer); controller?.abort();
    if (!farm || !size) return;
    const selected = farm, dimensions = size;
    controller = new AbortController();
    const { signal } = controller;
    timer = setTimeout(async () => {
      try {
        const frame = await render(selected, dimensions, signal);
        if (current === generation && !signal.aborted) onFrame(frame);
      } catch {
        if (current === generation && !signal.aborted) onFrame({ note: 'Não foi possível carregar a prévia de satélite. Abra o mapa para conferir o talhão.' });
      }
    }, debounce);
  }
  return {
    setFarm(value) { farm = value; refresh(); },
    resize(width, height) {
      const next = previewDimensions(width, height, pixelRatio());
      if (size?.width === next.width && size?.height === next.height) return;
      size = next; refresh();
    },
    refresh,
  };
}
