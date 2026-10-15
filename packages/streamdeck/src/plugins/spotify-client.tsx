import type { IconProps } from '../icon-registry.tsx';
import type { Client } from '../plugin-client.ts';
import { presentation } from './spotify-presentation.tsx';

function Spotifast({ size = 32, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill={color}
      fillRule="evenodd"
      aria-hidden="true"
    >
      <path d="M126 64a62 62 0 1 1-124 0 62 62 0 0 1 124 0ZM44.2 43.5A5 5 0 0 1 51.63 39.13L88.53 59.63A5 5 0 0 1 88.53 68.37L51.63 88.87A5 5 0 0 1 44.2 84.5Z" />
    </svg>
  );
}
export const client: Client = {
  id: 'spotify',
  icons: { spotifast: Spotifast },
  presentations: [presentation],
};
