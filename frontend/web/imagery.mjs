// Shared by the editor and the Rune summary preview.
export const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_CREDIT = 'Esri, Vantor, Earthstar Geographics and the GIS community';
export const BOUNDARY_STYLE = { color: '#d4f398', fillColor: '#bbdd82', fillOpacity: 0.22, weight: 3 };

export function satelliteTileUrl({ z, x, y }) {
  return SATELLITE_TILES.replace('{z}', z).replace('{y}', y).replace('{x}', x);
}
