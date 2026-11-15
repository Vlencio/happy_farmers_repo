import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { normalizeFarm } from './geometry.mjs';
import { BOUNDARY_STYLE, SATELLITE_CREDIT, SATELLITE_TILES } from './imagery.mjs';
import { parseCoordinates } from './coordinates.mjs';

export function downloadGeoJSON(farm) {
  const data = structuredClone(farm.geojson);
  data.properties.name = farm.name;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'happy-farmers-boundary.geojson'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createFarmMap(onConfirm) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('map-dialog');
  let map, boundary, candidate, source = 'draw', tileWarning = false;
  const status = (message, error = false) => {
    $('map-status').textContent = message;
    $('map-status').classList.toggle('error', error);
  };
  function refresh() {
    candidate = null;
    if (boundary) {
      try {
        const input = boundary.toGeoJSON(false);
        input.features[0].properties.name = $('farm-name').value.trim() || 'My farm';
        candidate = normalizeFarm(input, { source });
        $('map-area').textContent = `${candidate.area_ha.toLocaleString('en-US', { maximumFractionDigits: 2 })} ha`;
        $('geojson-preview').textContent = JSON.stringify(candidate.geojson, null, 2);
        status(tileWarning ? 'Some satellite imagery could not be loaded. The boundary is still available.' : `${candidate.point_count} vertices · WGS84 · Check the boundary before confirming.`, tileWarning);
      } catch (error) {
        $('map-area').textContent = 'Invalid boundary';
        $('geojson-preview').textContent = 'Fix the boundary to view its GeoJSON.';
        status(error.message, true);
      }
    } else {
      $('map-area').textContent = 'No boundary';
      $('geojson-preview').textContent = 'Draw or import a boundary.';
    }
    const drawing = map?.pm.globalDrawModeEnabled();
    $('confirm-boundary').disabled = !candidate || drawing;
    $('download-map').disabled = !candidate || drawing;
    $('edit-boundary').disabled = !boundary;
    $('finish-draw').disabled = !drawing;
    $('draw-boundary').setAttribute('aria-pressed', String(Boolean(drawing)));
    $('edit-boundary').setAttribute('aria-pressed', String(Boolean(map?.pm.globalEditModeEnabled())));
  }
  function mount(geojson) {
    if (boundary) boundary.remove();
    boundary = geojson ? L.geoJSON(geojson, { style: BOUNDARY_STYLE }).addTo(map) : null;
    boundary?.eachLayer((layer) => { layer.on('pm:edit', refresh); layer.on('pm:update', refresh); });
    refresh();
  }
  function init() {
    map = L.map('satellite-map', { zoomControl: true, preferCanvas: true }).setView([-20.032, -48.526], 13);
    L.tileLayer(SATELLITE_TILES, {
      maxZoom: 19, attribution: `Tiles &copy; ${SATELLITE_CREDIT}`,
    }).on('tileerror', () => { tileWarning = true; status('Satellite imagery is unavailable or incomplete. Check your connection; you can still import and review a boundary.', true); }).addTo(map);
    map.pm.setLang('en');
    map.on('pm:drawstart', refresh);
    map.on('pm:drawend', refresh);
    map.on('pm:globaleditmodetoggled', refresh);
    map.on('pm:create', (event) => {
      source = 'draw'; mount(event.layer.toGeoJSON(false)); event.layer.remove();
      $('map-help').textContent = 'Boundary complete. Edit the points if needed, then choose Use this area.';
    });
    $('draw-boundary').onclick = () => {
      map.pm.disableGlobalEditMode();
      map.pm.enableDraw('Polygon', { snappable: true, allowSelfIntersection: false, templineStyle: { color: '#d4f398' }, pathOptions: { color: '#d4f398' } });
      $('map-help').textContent = 'Click or tap each vertex. Close at the first point or use Finish drawing. The completed drawing replaces the previous boundary.';
    };
    $('finish-draw').onclick = () => {
      if (!map.pm.Draw.Polygon.enabled()) { status('Choose Draw boundary to start.'); return; }
      if (!map.pm.finishDraw()) status('Mark at least three points and check that the boundary does not cross itself.', true);
    };
    $('edit-boundary').onclick = () => {
      map.pm.disableDraw(); map.pm.toggleGlobalEditMode({ allowSelfIntersection: false });
      $('map-help').textContent = 'Drag vertices to adjust the boundary. Drag the points between them to add new vertices.';
    };
    $('coordinate-search').onsubmit = (event) => {
      event.preventDefault();
      let parts;
      try { parts = parseCoordinates($('coordinates').value); }
      catch (error) { status(error.message, true); $('coordinates').setAttribute('aria-invalid', 'true'); return; }
      $('coordinates').removeAttribute('aria-invalid');
      map.setView(parts, 15); status('Location found from the coordinates.');
    };
    $('locate').onclick = () => {
      if (!navigator.geolocation) { status('Location is unavailable in this browser.', true); return; }
      status('Finding your device location…');
      navigator.geolocation.getCurrentPosition((position) => {
        map.setView([position.coords.latitude, position.coords.longitude], 15);
        status('Approximate device location. Check the boundary on the map.');
      }, () => status('Location unavailable. Browse the map or enter coordinates.', true), { timeout: 12000 });
    };
  }
  $('farm-name').addEventListener('input', refresh);
  $('close-map').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { map?.pm.disableDraw(); map?.pm.disableGlobalEditMode(); document.getElementById('rune-app').focus(); });
  $('download-map').onclick = () => { refresh(); if (candidate) downloadGeoJSON(candidate); };
  $('confirm-boundary').onclick = () => {
    map.pm.disableDraw(); map.pm.disableGlobalEditMode(); refresh();
    if (candidate) { onConfirm(candidate); dialog.close(); }
  };
  return {
    open(farm) {
      dialog.showModal();
      if (!map) init();
      map.pm.disableDraw(); map.pm.disableGlobalEditMode();
      source = farm?.source || 'draw';
      $('farm-name').value = farm?.name || 'My farm';
      $('map-help').textContent = farm
        ? 'Review the imported or saved area. Use Edit points to adjust the boundary.'
        : 'Zoom in, choose Draw boundary and mark the field edges. Tap the first point to close the shape.';
      status(''); mount(farm?.geojson);
      requestAnimationFrame(() => {
        map.invalidateSize();
        if (boundary) map.fitBounds(boundary.getBounds(), { padding: [35, 35], maxZoom: 17 });
      });
    },
  };
}
