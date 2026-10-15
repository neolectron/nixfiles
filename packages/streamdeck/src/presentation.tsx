import { Effect, Schema } from 'effect';
import type { ComponentType, ReactNode } from 'react';

/** JSON is synchronized; components remain local code in the browser bundle. */
export const View = Schema.Struct({ type: Schema.NonEmptyString, data: Schema.Json });
export type View = typeof View.Type;
export const Dimension = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0));
const offset = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const Region = Schema.Struct({
  x: offset,
  y: offset,
  width: Dimension,
  height: Dimension,
  view: View,
  interactive: Schema.optionalKey(Schema.Boolean),
});
export type Region = typeof Region.Type;
export const define = <S extends Schema.ConstraintCodec<unknown, unknown>>(
  type: string,
  schema: S,
  Component: ComponentType<{ value: S['Type'] }>,
) => {
  const codec = Schema.toCodecJson(schema);
  return {
    type,
    describe: (value: S['Type']) =>
      Schema.encodeEffect(codec)(value).pipe(Effect.map((data) => ({ type, data }) satisfies View)),
    render: (data: Schema.Json): ReactNode => (
      <Component value={Schema.decodeUnknownSync(codec)(data)} />
    ),
  };
};
export const registry = (
  definitions: ReadonlyArray<{ type: string; render: (data: Schema.Json) => ReactNode }>,
) => {
  const renderers = new Map(definitions.map((definition) => [definition.type, definition.render]));
  return (view: View): ReactNode => {
    const render = renderers.get(view.type);
    if (!render) return null;
    try {
      return render(view.data);
    } catch {
      return null;
    }
  };
};
