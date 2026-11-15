// Web Mercator, matching Leaflet's EPSG:3857 / 256 px tile grid.
// Both imagery and ALL GeoJSON rings use this one transform.
export function projectCoordinate([lon, lat]) {
  const sine = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)];
}

export function previewDimensions(width, height, ratio = 1) {
  if (![width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0) {
    throw new Error('Invalid dimensions for the map preview.');
  }
  const scale = Math.min(ratio, 2, 1024 / width, 512 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function planPreview(geojson, width, height, scale = 1) {
  const geometry = geojson.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const projected = polygons.map((rings) => rings.map((ring) => ring.map(projectCoordinate)));
  const points = projected.flat(2);
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const west = Math.min(...xs), east = Math.max(...xs), north = Math.min(...ys), south = Math.max(...ys);
  const padding = Math.min(28 * scale, width / 4, height / 4);
  const fit = Math.min((width - 2 * padding) / (east - west), (height - 2 * padding) / (south - north));
  const zoom = Math.max(0, Math.min(19, Math.floor(Math.log2(fit / 256))));
  const world = 256 * 2 ** zoom;
  const left = (west + east) / 2 * world - width / 2;
  const top = (north + south) / 2 * world - height / 2;
  const rings = projected.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x * world - left, y * world - top])));
  const tiles = [], count = 2 ** zoom;
  for (let y = Math.floor(top / 256); y <= Math.floor((top + height - 1) / 256); y++) {
    if (y < 0 || y >= count) continue;
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width - 1) / 256); x++) {
      tiles.push({ z: zoom, x: ((x % count) + count) % count, y, left: x * 256 - left, top: y * 256 - top });
    }
  }
  return { width, height, rings, tiles, scale };
}
