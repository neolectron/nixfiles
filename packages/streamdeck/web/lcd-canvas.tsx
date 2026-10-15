import { useRef, type ReactNode, type PointerEvent } from 'react';
import { Effect } from 'effect';
import type { Snapshot, Catalogue } from '../src/studio-contract.ts';
import * as Layout from '../src/lcd-layout.ts';
import { commandFor } from '../src/navigation.ts';
import { LcdView } from './lcd-view.tsx';
import { ActionCard } from '../src/ui/action-presentation.tsx';
import * as Api from './api.ts';

export function LcdCanvas({
  lcd,
  snapshot,
  catalogue,
  draft,
  disabled,
  dropTarget,
  onSelect,
  onNavigate,
  onSnapshot,
  onError,
  children,
}: {
  lcd: Snapshot['lcds'][number];
  snapshot: Snapshot;
  catalogue: Catalogue | undefined;
  draft: boolean;
  disabled: boolean;
  dropTarget: boolean;
  onSelect: (id: string | null) => void;
  onNavigate: (command: Layout.Command) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (error: unknown) => void;
  children?: ReactNode;
}) {
  const config = snapshot.configuration.profile.lcd ?? Layout.empty;
  const views = Layout.project(
    config,
    snapshot.lcdLayout?.navigation ?? {},
    lcd.index,
    snapshot.lcdLayout?.focus ?? null,
  );
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    revision: number;
  } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * lcd.width,
      y: ((event.clientY - rect.top) / rect.height) * lcd.height,
    };
  };
  const send = (
    kind: 'tap' | 'hold' | 'swipe',
    x: number,
    y: number,
    revision: number,
    toX?: number,
  ) => {
    if (disabled) return;
    const view = views.find((entry) => x >= entry.zone.x && x < entry.zone.x + entry.zone.width);
    if (draft) {
      if (!view) return;
      if (kind === 'swipe')
        onNavigate({ zone: view.zone.id, operation: 'scroll', delta: Math.round(x - (toX ?? x)) });
      else {
        const hit = view.tiles.find(
          (entry) =>
            entry.width > 0 &&
            x - view.zone.x >= Math.max(0, entry.x) &&
            x - view.zone.x < Math.min(view.zone.width, entry.x + entry.tile.width),
        );
        const command = hit ? commandFor(hit.tile) : undefined;
        if (command?.surface === 'lcd')
          onNavigate({
            zone: command.zone === 'current' ? view.zone.id : command.zone,
            operation: command.operation,
            ...(command.operation === 'open' ? { folder: command.folder } : {}),
          });
      }
      return;
    }
    Effect.runFork(
      Api.lcdInput({
        lcd: lcd.index,
        kind,
        x,
        y,
        revision,
        sessionId: snapshot.sessionId,
        ...(toX === undefined ? {} : { toX }),
      }).pipe(Effect.match({ onSuccess: onSnapshot, onFailure: onError })),
    );
  };
  const background =
    draft && lcd.scene
      ? {
          ...lcd,
          scene: lcd.scene.filter(
            (entry) => entry.view.type !== 'lcd.clip.v1' && entry.view.type !== 'lcd.blank.v1',
          ),
        }
      : lcd;
  return (
    <div
      className={`lcd-strip${dropTarget ? ' lcd-drop-target' : ''}`}
      style={{ aspectRatio: `${lcd.width}/${lcd.height}` }}
      aria-label="Écran LCD"
      data-lcd-slot={lcd.index}
      data-lcd-width={lcd.width}
      data-lcd-drop-allowed={!disabled ? 'true' : 'false'}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect(null);
      }}
      onPointerDown={(event) => {
        if (
          disabled ||
          event.button !== 0 ||
          !event.isPrimary ||
          (event.target as Element).closest('.lcd-tile-edit')
        )
          return;
        const p = point(event);
        if (
          !views.some((view) => p.x >= view.zone.x && p.x < view.zone.x + view.zone.width) &&
          !lcd.scene?.some(
            (region) =>
              region.interactive &&
              p.x >= region.x &&
              p.x < region.x + region.width &&
              p.y >= region.y &&
              p.y < region.y + region.height,
          )
        )
          return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = {
          id: event.pointerId,
          ...p,
          start: event.timeStamp,
          revision: snapshot.lcdLayout?.revision ?? 0,
        };
      }}
      onPointerUp={(event) => {
        const before = pointer.current;
        pointer.current = null;
        if (!before || before.id !== event.pointerId) return;
        const after = point(event);
        send(
          Math.abs(after.x - before.x) > 15
            ? 'swipe'
            : event.timeStamp - before.start >= 600
              ? 'hold'
              : 'tap',
          before.x,
          before.y,
          before.revision,
          after.x,
        );
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
    >
      <LcdView lcd={background} sessionId={snapshot.sessionId} />
      {children}
      {(lcd.scene ?? [])
        .filter((region) => region.interactive)
        .map((region, index) => (
          <button
            type="button"
            className="lcd-surface-hit"
            key={`${region.x}/${region.y}/${region.width}/${region.height}/${region.view.type}`}
            aria-label={`Présentation LCD ${index + 1}`}
            disabled={disabled || draft}
            style={{
              left: `${(region.x / lcd.width) * 100}%`,
              top: `${(region.y / lcd.height) * 100}%`,
              width: `${(region.width / lcd.width) * 100}%`,
              height: `${(region.height / lcd.height) * 100}%`,
            }}
            onClick={(event) => {
              if (event.detail === 0)
                send('tap', region.x + 1, region.y + 1, snapshot.lcdLayout?.revision ?? 0);
            }}
          />
        ))}
      {views.map((view) => (
        <div
          className="lcd-zone-hit"
          key={view.zone.id}
          style={{
            left: `${(view.zone.x / lcd.width) * 100}%`,
            width: `${(view.zone.width / lcd.width) * 100}%`,
          }}
        >
          {draft ? <div className="lcd-draft-background" /> : null}
          {view.tiles
            .filter((entry) => entry.width > 0)
            .map((entry) => {
              const info = catalogue?.pluginActions.find(
                (action) => action.plugin === entry.tile.plugin && action.id === entry.tile.action,
              );
              return (
                <div
                  className="lcd-tile-hit"
                  key={entry.tile.id}
                  style={{
                    left: `${(Math.max(0, entry.x) / view.zone.width) * 100}%`,
                    width: `${(entry.width / view.zone.width) * 100}%`,
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(entry.tile.id);
                  }}
                >
                  {draft ? (
                    <svg
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${entry.width} ${lcd.height}`}
                      aria-hidden="true"
                    >
                      <foreignObject width={entry.width} height={lcd.height}>
                        <div style={{ width: entry.width, height: lcd.height, overflow: 'hidden' }}>
                          <div style={{ marginLeft: -entry.left }}>
                            <ActionCard
                              value={{
                                width: entry.tile.width,
                                height: lcd.height,
                                label: entry.tile.label,
                                count: 0,
                                feedback: info?.tile
                                  ? { icon: info.tile.icon, text: '', tone: 'neutral' }
                                  : null,
                              }}
                            />
                          </div>
                        </div>
                      </foreignObject>
                    </svg>
                  ) : null}
                  <button
                    className="lcd-tile-action"
                    aria-label={`${entry.tile.label} · LCD`}
                    disabled={disabled}
                    onClick={(event) => {
                      if (event.detail === 0)
                        send(
                          'tap',
                          view.zone.x + Math.max(0, entry.x) + entry.width / 2,
                          lcd.height / 2,
                          snapshot.lcdLayout?.revision ?? 0,
                        );
                    }}
                  />
                  <button
                    className="lcd-tile-edit"
                    aria-label={`Modifier la tile LCD ${entry.tile.label}`}
                    disabled={disabled}
                    onClick={() => onSelect(entry.tile.id)}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="m16 3 5 5L8 21H3v-5L16 3Z" />
                    </svg>
                  </button>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
