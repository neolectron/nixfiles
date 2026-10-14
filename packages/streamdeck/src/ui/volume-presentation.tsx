import { Schema } from 'effect';
import * as Presentation from '../presentation.tsx';
import { VolumeCard } from './volume-card.tsx';

const icons = {
  spotify: new URL('../../assets/icons/spotify.svg', import.meta.url).href,
  discord: new URL('../../assets/icons/discord.svg', import.meta.url).href,
  googlechrome: new URL('../../assets/icons/googlechrome.svg', import.meta.url).href,
};
const iconFor = (key: string, online: boolean) => (
  <span
    aria-hidden={true}
    style={{
      display: 'block',
      width: 19,
      height: 19,
      flexShrink: 0,
      opacity: online ? 1 : 0.45,
      backgroundColor: key === 'spotify' ? '#1ED760' : key === 'discord' ? '#8B83FF' : '#F7C65A',
      maskImage: `url(${icons[key as keyof typeof icons]})`,
      maskSize: 'contain',
      maskRepeat: 'no-repeat',
    }}
  />
);
export const presentation = Presentation.define(
  'mixer.volume.v1',
  Schema.Struct({
    width: Presentation.Dimension,
    height: Presentation.Dimension,
    online: Schema.Boolean,
    title: Schema.NullOr(Schema.String),
    app: Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
        volume: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
        muted: Schema.Boolean,
        mixedMute: Schema.Boolean,
      }),
    ),
  }),
  ({ value }) => (
    <VolumeCard
      {...value}
      title={value.title ?? undefined}
      app={value.app ?? undefined}
      icons={icons}
      iconFor={iconFor}
    />
  ),
);
