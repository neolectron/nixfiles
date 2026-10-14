export interface Identity {
  readonly key: string;
  readonly name: string;
  readonly aliases?: ReadonlyArray<string>;
}
