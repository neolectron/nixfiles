export function DragGrip() {
  return (
    <svg width={12} height={16} viewBox="0 0 12 16" aria-hidden={true}>
      {[3, 8, 13].flatMap((y) =>
        [3, 9].map((x) => <circle key={`${x}/${y}`} cx={x} cy={y} r={1.25} fill="currentColor" />),
      )}
    </svg>
  );
}
