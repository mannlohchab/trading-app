// Brings model-written tool arguments to the types the tool's JSON schema declares, before strict
// validation. Models that write calls as text (Nemotron's <parameter=…> format) often deliver
// numbers, booleans, arrays and objects as strings, depending on the provider's parser. Only type
// conversions happen here; unknown keys and invalid values are still rejected by the tool schema.

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  enum?: unknown[];
  $ref?: string;
  definitions?: Record<string, Schema>;
  $defs?: Record<string, Schema>;
};

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

const typesOf = (s: Schema): string[] => (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []);

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function fits(value: unknown, type: string): boolean {
  switch (type) {
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'array': return Array.isArray(value);
    case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
}

export function coerceToSchema(value: unknown, schema: Schema | undefined, root: Schema = schema ?? {}, depth = 0): unknown {
  if (!schema || depth > 20) return value;
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/(?:definitions|\$defs)\//, '');
    return coerceToSchema(value, root.definitions?.[name] ?? root.$defs?.[name], root, depth + 1);
  }
  for (const part of schema.allOf ?? []) value = coerceToSchema(value, part, root, depth + 1);
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    // Keep a value one branch already accepts; otherwise take the first branch that converts it.
    if (branches.some(b => typesOf(b).some(t => fits(value, t)))) {
      const match = branches.find(b => typesOf(b).some(t => fits(value, t)))!;
      return coerceToSchema(value, match, root, depth + 1);
    }
    for (const branch of branches) {
      const converted = coerceToSchema(value, branch, root, depth + 1);
      if (typesOf(branch).some(t => fits(converted, t))) return converted;
    }
    return value;
  }

  const types = typesOf(schema);
  if (!types.length && !schema.properties && !schema.items) return value;
  if (types.some(t => fits(value, t)) && !schema.properties && !schema.items) return value;

  if (typeof value === 'string') {
    const text = value.trim();
    if ((types.includes('integer') || types.includes('number')) && NUMBER.test(text)) return Number(text);
    if (types.includes('boolean') && /^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (types.includes('null') && text === 'null') return null;
    if (types.includes('array') || types.includes('object') || schema.properties || schema.items) {
      const parsed = parseJson(text);
      if (parsed !== undefined && typeof parsed === 'object') value = parsed;
    }
  }
  if (typeof value === 'number' && types.includes('string') && !types.includes('number')) return String(value);

  if (Array.isArray(value)) {
    return schema.items ? value.map(item => coerceToSchema(item, schema.items, root, depth + 1)) : value;
  }
  // A single value where a list is expected: ["BTCUSDT"] written as "BTCUSDT".
  if (types.includes('array') && value !== null && value !== undefined && typeof value !== 'object') {
    return [coerceToSchema(value, schema.items, root, depth + 1)];
  }
  if (value && typeof value === 'object' && schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = key in schema.properties ? coerceToSchema(item, schema.properties[key], root, depth + 1) : item;
    }
    return out;
  }
  return value;
}
