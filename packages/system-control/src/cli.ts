import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, Layer, Option, Path, Result, Schedule } from 'effect';
import { Command, Flag } from 'effect/cli';
import { Audio } from './audio.ts';
import { Spotify } from './spotify.ts';
import { MediaPlayers } from './media.ts';
import { Discord } from './discord.ts';
import { DiscordConnection, make as makeConnection } from './discord-connection.ts';
import * as Runtime from './runtime.ts';

const publicResult = <A, E extends { readonly message: string }>(value: Result.Result<A, E>) =>
  Result.isSuccess(value)
    ? { available: true, state: value.success }
    : { available: false, error: value.failure.message };
const inspect = Command.make(
  'inspect',
  {
    discordConnection: Flag.String('discord-connection').pipe(
      Flag.optional,
      Flag.withDescription('Existing OAuth connection file; never authorizes a new account.'),
    ),
  },
  ({ discordConnection }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const services = Option.isSome(discordConnection)
        ? Runtime.layer.pipe(
            Layer.provide(
              Layer.effect(
                DiscordConnection,
                makeConnection(path.resolve(discordConnection.value)),
              ),
            ),
          )
        : Runtime.layer;
      yield* Effect.gen(function* () {
        const audio = yield* Audio;
        const spotify = yield* Spotify;
        const media = yield* MediaPlayers;
        const discord = yield* Discord;
        const snapshots = yield* Effect.all(
          {
            audio: audio.state.pipe(Effect.result, Effect.map(publicResult)),
            spotify: spotify.current.pipe(Effect.result, Effect.map(publicResult)),
            media: media.current.pipe(Effect.result, Effect.map(publicResult)),
            discord: discord.current.pipe(
              Effect.retry({ times: 10, schedule: Schedule.spaced(50) }),
              Effect.result,
              Effect.map(publicResult),
            ),
          },
          { concurrency: 'unbounded' },
        );
        yield* Console.log(JSON.stringify(snapshots, null, 2));
      }).pipe(Effect.provide(services));
    }),
);
const command = Command.make('system').pipe(Command.withSubcommands([inspect]));
NodeRuntime.runMain(
  Command.run(command, { version: '0.1.0' }).pipe(Effect.provide(NodeServices.layer)),
);
