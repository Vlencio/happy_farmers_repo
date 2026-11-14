// A comma can be a decimal mark or a separator. Require whitespace or a
// semicolon between two decimal-comma values so the location is unambiguous.
export function parseCoordinates(value) {
  const text = String(value).trim().replaceAll('−', '-');
  const decimal = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
  const separated = new RegExp(`^(${decimal})(?:\\s*;\\s*|\\s+)(${decimal})$`).exec(text);
  const dotted = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/.exec(text);
  const match = separated || dotted;
  const coordinates = match?.slice(1).map(part => Number(part.replace(',', '.')));
  if (!coordinates || !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 85 || Math.abs(coordinates[1]) > 180) {
    throw new Error('Informe latitude e longitude. Exemplos: -20,032; -48,526 ou -20.032, -48.526. Latitude entre −85 e 85; longitude entre −180 e 180.');
  }
  return coordinates;
}
