import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates } from '../web/coordinates.mjs';

test('accepts Brazilian and dot decimals without confusing the location', () => {
  for (const text of ['-20,032; -48,526', '-20,032 -48,526', '-20.032, -48.526', '-20.032;-48.526', ' −20,032; −48,526 ']) {
    assert.deepEqual(parseCoordinates(text), [-20.032, -48.526], text);
  }
  assert.deepEqual(parseCoordinates('0, 0'), [0, 0]);
  assert.deepEqual(parseCoordinates('85; -180'), [85, -180]);
});

test('rejects ambiguous, empty, nondecimal and out-of-map coordinates', () => {
  for (const text of ['', ';', '-20,032,-48,526', '20 30 40', 'NaN 0', 'Infinity,0', '0x10,0', '1e2;0', '86;0', '0;-181', '20;;30']) {
    assert.throws(() => parseCoordinates(text), /latitude and longitude/, text);
  }
});
