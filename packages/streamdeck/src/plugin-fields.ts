/** Small JSON Schema form projection. Complex values retain a lossless JSON editor. */
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export interface Field {
  readonly key: string; readonly label: string; readonly hint: string; readonly required: boolean;
  readonly kind: 'text' | 'number' | 'boolean' | 'select' | 'json';
  readonly options: ReadonlyArray<string | number | boolean>; readonly min?: number; readonly max?: number; readonly minLength?: number; readonly maxLength?: number;
}
export const fields = (document: unknown): ReadonlyArray<Field> => {
  const doc = object(document) ? document : {};
  const definitions = object(doc.definitions) ? doc.definitions : object(doc.$defs) ? doc.$defs : {};
  const resolve = (value: unknown): Record<string, unknown> => {
    const schema = object(value) ? value : {};
    const ref = typeof schema.$ref === 'string' ? schema.$ref.split('/').at(-1) : undefined;
    return ref && object(definitions[ref]) ? { ...definitions[ref], ...schema } : schema;
  };
  const root = resolve(doc.schema ?? doc);
  const properties = object(root.properties) ? root.properties : undefined;
  if (!properties) return [{ key: '$root', label: typeof root.title === 'string' ? root.title : 'Paramètres JSON', hint: 'Valeur structurée, validée par le plugin.', required: true, kind: 'json', options: [] }];
  return Object.entries(properties).map(([key, value]) => {
    const schema = resolve(value);
    const candidates = Array.isArray(schema.enum) ? schema.enum : Array.isArray(schema.anyOf) ? schema.anyOf.map((node) => resolve(node).const) : [];
    const options = candidates.filter((value): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value));
    return { key, label: typeof schema.title === 'string' ? schema.title : key, hint: typeof schema.description === 'string' ? schema.description : '', required: Array.isArray(root.required) && root.required.includes(key),
      kind: options.length ? 'select' : schema.type === 'string' ? 'text' : schema.type === 'integer' || schema.type === 'number' ? 'number' : schema.type === 'boolean' ? 'boolean' : 'json', options,
      ...(typeof schema.minLength === 'number' ? { minLength: schema.minLength } : {}), ...(typeof schema.maxLength === 'number' ? { maxLength: schema.maxLength } : {}),
      ...(typeof schema.minimum === 'number' ? { min: schema.minimum } : {}), ...(typeof schema.maximum === 'number' ? { max: schema.maximum } : {}),
    };
  });
};
export const draft = (schema: unknown, input: unknown): Record<string, string> => Object.fromEntries(fields(schema).map((field) => {
  const value = field.key === '$root' ? input : object(input) ? input[field.key] : undefined;
  return [`input:${field.key}`, value === undefined ? '' : field.kind === 'json' ? JSON.stringify(value) : String(value)];
}));
export const input = (schema: unknown, values: Readonly<Record<string, string>>): unknown => {
  const entries = fields(schema).flatMap((field) => {
    const raw = values[`input:${field.key}`] ?? '';
    if (!raw && !field.required) return [];
    const value = field.kind === 'json' ? JSON.parse(raw) : field.kind === 'number' ? Number(raw) : field.kind === 'boolean' ? raw === 'true' : field.kind === 'select' ? field.options.find((value) => String(value) === raw) : raw;
    return [[field.key, value] as const];
  });
  return entries[0]?.[0] === '$root' ? entries[0][1] : Object.fromEntries(entries);
};
