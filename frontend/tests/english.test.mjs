import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { englishSourceNotice, englishApiError } from '../web/external-text.mjs';
import { normalizeFarm } from '../web/geometry.mjs';
import { restoreDraft } from '../web/draft.mjs';

const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url)));

test('real Portuguese metadata is presented in English with sources, scope and units preserved', () => {
  const notice = englishSourceNotice(metadata.data_notice);
  assert.match(notice, /POWER 2005–2024.*around 2060.*regional/);
  assert.match(notice, /Triângulo Mineiro.*local suitability/);
  const source = englishSourceNotice(metadata.demo_field.sources);
  assert.match(source, /MOD13Q1, 250 m.*2014–2024.*SRTM, 30 m.*INMET A520/);
  assert.match(source, /one field.*different resolutions/);
  const soil = englishSourceNotice('GLDAS2/Noah (NASA LDAS), 0,25 grau. Sugestão regional por célula de 0,25°; confirme com o que você conhece do talhão.');
  assert.match(soil, /GLDAS2\/Noah.*0\.25°.*Regional suggestion.*confirm/);
  assert.equal(englishSourceNotice(metadata.demo_field.station.name), metadata.demo_field.station.name);
});

test('translated source notices retain fallback, regional coverage and rainfall caveats', () => {
  const warning = 'POWER fora do ar. O ponto do talhão está fora de Minas Gerais.';
  assert.equal(englishSourceNotice(warning), 'POWER is unavailable. The field point is outside Minas Gerais.');
  const fallback = englishSourceNotice('Sem clima do POWER para este ponto (ValueError: dados inválidos). Usando as tabelas do talhao de demonstracao, a 72 km.');
  assert.match(fallback, /POWER climate data is unavailable.*demonstration-field tables from 72 km/);
  const regional = englishSourceNotice('POWER do ponto e projeção NEX-GDDP regional, sem correção da estação A520. No norte da grade, há extremos de chuva conhecidos nos dados NEX-GDDP que podem afetar a receita futura e a ordem de opções próximas.');
  assert.match(regional, /without the A520.*northern.*rainfall extremes.*future revenue/);
  assert.match(englishSourceNotice('Novo aviso sobre dados climáticos.'), /without an English translation/);
  assert.equal(englishSourceNotice('NASA POWER is temporarily unavailable.'), 'NASA POWER is temporarily unavailable.');
  assert.equal(englishSourceNotice('The field area is outside the grid.'), 'The field area is outside the grid.');
  assert.equal(englishSourceNotice(null), '');
});

test('server errors are understandable in English and validation arrays do not leak wire labels', () => {
  assert.equal(englishApiError('O chat não está disponível neste servidor.'), 'Chat is not available on this server.');
  assert.match(englishApiError('Culturas fora da tabela: ["x"].'), /crops are not supported.*crop history/);
  assert.match(englishApiError([{ loc: ['body', 'mes_plantio'], msg: 'Input should be less than 13' }]), /invalid values/);
  assert.equal(englishApiError('Dados inválidos.', 'Please retry.'), 'Please retry.');
  assert.equal(englishApiError('Falha controlada.', 'Please retry.'), 'Please retry.');
  assert.equal(englishApiError('Network request failed'), 'Network request failed');
});

test('language changes never translate user-authored field names and notes or crop IDs', () => {
  const name = 'Fazenda Água Clara', notes = 'Milho após a chuva';
  const farm = normalizeFarm(metadata.demo_field.boundary, { source: 'import' });
  farm.geojson.properties.name = name;
  const restored = restoreDraft(JSON.stringify({ version: 2, farm,
    history: [{ crop: 'milho', season: '2025', notes }],
    settings: { mes_plantio: 10, horizonte: 2 } }));
  assert.equal(restored.farm.name, name);
  assert.equal(restored.history[0].notes, notes);
  assert.equal(restored.history[0].crop, 'milho');
});
