import { Config, Effect, Option } from 'effect';

/** Nix supplies the immutable CJK collection; source development uses the same shell variable. */
export const cjkFont = Config.String('STREAMDECK_CJK_FONT').pipe(Config.option);
export const cjkFontFiles = Effect.map(cjkFont, (file) =>
  Option.isSome(file) ? [file.value] : [],
);
export const fontFamilies = ['Liberation Sans', 'Noto Sans CJK JP'];
