import type { Color } from './model.ts';
import { MAX_VOLUME_PERCENT } from '@nixfiles/system-control/audio.ts';

/** Nominal stays white; the boost half progresses yellow → orange → red at its ceiling. */
export const volumeColor = (percent: number, maximum = MAX_VOLUME_PERCENT): Color => {
  if (percent <= 100) return [255, 255, 255];
  const boost = Math.max(0, Math.min(1, (percent - 100) / (maximum - 100)));
  const yellow: Color = [255, 220, 40];
  const orange: Color = [255, 145, 30];
  const red: Color = [255, 55, 55];
  const from = boost < 0.5 ? yellow : orange;
  const to = boost < 0.5 ? orange : red;
  const amount = boost < 0.5 ? boost * 2 : (boost - 0.5) * 2;
  const blend = (channel: 0 | 1 | 2) =>
    Math.round(from[channel] + (to[channel] - from[channel]) * amount);
  return [blend(0), blend(1), blend(2)];
};
export const css = (color: Color) => `rgb(${color.join(',')})`;
export const point = (center: number, radius: number, percent: number, maximum: number) => {
  const level = Math.max(0, Math.min(maximum, percent));
  const fraction = level <= 100 ? level / 200 : 0.5 + (level - 100) / (maximum - 100) / 2;
  const angle = Math.PI + fraction * Math.PI;
  return [center + Math.cos(angle) * radius, 91 + Math.sin(angle) * radius] as const;
};
export const arc = (center: number, radius: number, from: number, to: number, maximum: number) => {
  const a = point(center, radius, from, maximum);
  const b = point(center, radius, to, maximum);
  return `M ${a[0]} ${a[1]} A ${radius} ${radius} 0 0 1 ${b[0]} ${b[1]}`;
};
