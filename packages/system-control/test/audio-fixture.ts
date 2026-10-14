import { Effect, Layer } from 'effect';
import { Pactl, serviceLayer } from '../src/audio.ts';
export const input = (
  index: number,
  binary: string,
  values: number[],
  mute = false,
  serial = String(index),
) => ({
  index,
  mute,
  corked: false,
  volume: Object.fromEntries(values.map((value, i) => [`channel-${i}`, { value }])),
  properties: {
    'application.name': binary === 'Discord' ? 'WEBRTC VoiceEngine' : binary,
    'application.process.binary': `.${binary}-wrapped`,
    'object.serial': serial,
    'media.class': 'Stream/Output/Audio',
  },
});
export const audio = (
  initial = [input(7415, 'Spotify', [13107, 13107]), input(28015, 'Discord', [65536, 0])],
) => {
  let sink = {
    name: 'output',
    mute: false,
    volume: { left: { value: 32768 }, right: { value: 16384 } },
    properties: { 'object.serial': 'sink-1' },
  };
  let defaultSink = sink.name;
  let inputs = initial;
  let reads = 0;
  const commands: string[][] = [];
  let onRead: ((count: number) => void) | undefined;
  const pactl = Layer.succeed(
    Pactl,
    Pactl.of({
      run: (args) =>
        Effect.sync(() => {
          if (args[0] === 'get-default-sink') return `${defaultSink}\n`;
          if (args[0] === '--format=json' && args[2] === 'sinks') return JSON.stringify([sink]);
          if (args[0] === '--format=json') {
            onRead?.(++reads);
            return JSON.stringify(inputs);
          }
          commands.push([...args]);
          if (args[0] === 'set-sink-mute') sink = { ...sink, mute: args[2] === '1' };
          if (args[0] === 'set-sink-volume')
            sink = {
              ...sink,
              volume: { left: { value: Number(args[2]) }, right: { value: Number(args[3]) } },
            };
          inputs = inputs.map((row) =>
            row.index !== Number(args[1])
              ? row
              : {
                  ...row,
                  ...(args[0] === 'set-sink-input-mute' ? { mute: args[2] === '1' } : {}),
                  ...(args[0] === 'set-sink-input-volume'
                    ? {
                        volume: Object.fromEntries(
                          Object.keys(row.volume).map((channel, i) => [
                            channel,
                            { value: Number(args[i + 2]) },
                          ]),
                        ),
                      }
                    : {}),
                },
          );
          return '';
        }),
    }),
  );
  return {
    commands,
    layer: serviceLayer.pipe(Layer.provide(pactl)),
    set: (next: typeof initial) => {
      inputs = next;
    },
    onRead: (callback: (count: number) => void) => {
      onRead = callback;
    },
    replaceSink: (name: string, serial: string) => {
      defaultSink = name;
      sink = { ...sink, name, properties: { 'object.serial': serial } };
    },
    removeDefault: () => {
      defaultSink = '';
    },
  };
};
