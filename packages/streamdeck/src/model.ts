export interface Size {
  readonly width: number;
  readonly height: number;
}
export interface Position {
  readonly x: number;
  readonly y: number;
}
export type Color = readonly [red: number, green: number, blue: number];

export interface Control {
  readonly type: 'button' | 'encoder' | 'lcd-segment';
  readonly index: number;
  readonly row?: number;
  readonly column?: number;
  readonly feedbackType?: 'none' | 'rgb' | 'lcd';
  readonly pixelSize?: Size;
  readonly bounds?: Position & Size;
}
export interface DeviceInfo {
  readonly path: string;
  readonly model: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly controls: ReadonlyArray<Control>;
}
export interface InputOrigin {
  readonly source: string;
  readonly address?: string;
  readonly revision?: number;
}
export type KeyDown = {
  readonly origin?: InputOrigin;
  readonly _tag: 'KeyDown';
  readonly key: number;
};
export type KeyUp = { readonly origin?: InputOrigin; readonly _tag: 'KeyUp'; readonly key: number };
export type DialDown = {
  readonly origin?: InputOrigin;
  readonly _tag: 'DialDown';
  readonly dial: number;
};
export type DialUp = {
  readonly origin?: InputOrigin;
  readonly _tag: 'DialUp';
  readonly dial: number;
};
export type DialRotate = {
  readonly origin?: InputOrigin;
  readonly _tag: 'DialRotate';
  readonly dial: number;
  readonly delta: number;
};
export type TouchTap = {
  readonly _tag: 'TouchTap';
  readonly lcd: number;
  readonly position: Position;
};
export type TouchHold = {
  readonly _tag: 'TouchHold';
  readonly lcd: number;
  readonly position: Position;
};
export type TouchSwipe = {
  readonly _tag: 'TouchSwipe';
  readonly lcd: number;
  readonly from: Position;
  readonly to: Position;
};
export type KeyCancel = {
  readonly _tag: 'KeyCancel';
  readonly key: number;
  readonly origin?: InputOrigin;
};
export type DialCancel = {
  readonly _tag: 'DialCancel';
  readonly dial: number;
  readonly origin?: InputOrigin;
};
export type DeckEvent =
  | KeyCancel
  | DialCancel
  | KeyDown
  | KeyUp
  | DialDown
  | DialUp
  | DialRotate
  | TouchTap
  | TouchHold
  | TouchSwipe;
