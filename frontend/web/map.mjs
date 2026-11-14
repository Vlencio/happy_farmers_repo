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
  link.href = url; link.download = 'happy-farmers-limite.geojson'; link.click();
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
        input.features[0].properties.name = $('farm-name').value.trim() || 'Minha fazenda';
        candidate = normalizeFarm(input, { source });
        $('map-area').textContent = `${candidate.area_ha.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`;
        $('geojson-preview').textContent = JSON.stringify(candidate.geojson, null, 2);
        status(tileWarning ? 'Não foi possível carregar parte da imagem satélite. O contorno continua disponível.' : `${candidate.point_count} vértices · WGS84 · Confira os limites antes de confirmar.`, tileWarning);
      } catch (error) {
        $('map-area').textContent = 'Contorno inválido';
        $('geojson-preview').textContent = 'Corrija o contorno para visualizar o GeoJSON.';
        status(error.message, true);
      }
    } else {
      $('map-area').textContent = 'Nenhum contorno';
      $('geojson-preview').textContent = 'Desenhe ou importe um contorno.';
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
    }).on('tileerror', () => { tileWarning = true; status('Imagem satélite indisponível ou incompleta. Verifique sua conexão; é possível importar e revisar o contorno.', true); }).addTo(map);
    map.pm.setLang('pt_br');
    map.on('pm:drawstart', refresh);
    map.on('pm:drawend', refresh);
    map.on('pm:globaleditmodetoggled', refresh);
    map.on('pm:create', (event) => {
      source = 'draw'; mount(event.layer.toGeoJSON(false)); event.layer.remove();
      $('map-help').textContent = 'Contorno concluído. Edite os pontos se necessário e escolha Usar esta área.';
    });
    $('draw-boundary').onclick = () => {
      map.pm.disableGlobalEditMode();
      map.pm.enableDraw('Polygon', { snappable: true, allowSelfIntersection: false, templineStyle: { color: '#d4f398' }, pathOptions: { color: '#d4f398' } });
      $('map-help').textContent = 'Clique ou toque em cada vértice. Feche no primeiro ponto ou use Concluir desenho. O novo desenho substitui o contorno anterior ao ser concluído.';
    };
    $('finish-draw').onclick = () => {
      if (!map.pm.Draw.Polygon.enabled()) { status('Escolha Desenhar contorno para iniciar.'); return; }
      if (!map.pm.finishDraw()) status('Marque ao menos três pontos e confira se o contorno não se cruza.', true);
    };
    $('edit-boundary').onclick = () => {
      map.pm.disableDraw(); map.pm.toggleGlobalEditMode({ allowSelfIntersection: false });
      $('map-help').textContent = 'Arraste os vértices para ajustar o limite. Os pontos intermediários adicionam novos vértices.';
    };
    $('coordinate-search').onsubmit = (event) => {
      event.preventDefault();
      let parts;
      try { parts = parseCoordinates($('coordinates').value); }
      catch (error) { status(error.message, true); $('coordinates').setAttribute('aria-invalid', 'true'); return; }
      $('coordinates').removeAttribute('aria-invalid');
      map.setView(parts, 15); status('Localização encontrada pelas coordenadas.');
    };
    $('locate').onclick = () => {
      if (!navigator.geolocation) { status('Localização não disponível neste navegador.', true); return; }
      status('Buscando a localização do dispositivo…');
      navigator.geolocation.getCurrentPosition((position) => {
        map.setView([position.coords.latitude, position.coords.longitude], 15);
        status('Localização aproximada do dispositivo. Confira o contorno no mapa.');
      }, () => status('Localização não disponível. Navegue pelo mapa ou informe as coordenadas.', true), { timeout: 12000 });
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
      $('farm-name').value = farm?.name || 'Minha fazenda';
      $('map-help').textContent = farm
        ? 'Confira a área importada ou salva. Use Editar pontos para ajustar o contorno.'
        : 'Aproxime o mapa, escolha Desenhar contorno e marque os limites. Toque no primeiro ponto para fechar.';
      status(''); mount(farm?.geojson);
      requestAnimationFrame(() => {
        map.invalidateSize();
        if (boundary) map.fitBounds(boundary.getBounds(), { padding: [35, 35], maxZoom: 17 });
      });
    },
  };
}
