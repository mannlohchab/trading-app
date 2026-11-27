// STAND-IN: written to get the app running; the original file was never
// committed (frontend/ is gitignored). Replace with the real one when available.
import type { Chart, Coordinate, Overlay } from "klinecharts";

export interface DrawingObjectState {
  id: string;
  /** Bar position in px, relative to the chart container. */
  x: number;
  y: number;
  locked: boolean;
  color: string;
  size: number;
}

const DEFAULT_COLOR = "#2962ff";
const COLORS = ["#2962ff", "#f07d00", "#089981", "#f23645", "#d1d4dc", "#9c27b0"];
const SIZES = [1, 2, 3, 4];
const BAR_W = 260;
const BAR_H = 34;

export function drawingFromOverlay(overlay: Overlay): Omit<DrawingObjectState, "x" | "y"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = (overlay as any).styles?.line ?? {};
  return {
    id: overlay.id,
    locked: overlay.lock,
    color: typeof line.color === "string" ? line.color : DEFAULT_COLOR,
    size: typeof line.size === "number" ? line.size : 1,
  };
}

export function overlayStylePatch(d: DrawingObjectState) {
  return {
    line: { color: d.color, size: d.size },
    polygon: { borderColor: d.color, borderSize: d.size },
    point: { color: d.color, borderColor: d.color },
  };
}

/** Places the bar just above the overlay's first point, kept inside `box`. */
export function barAnchor(chart: Chart, overlay: Overlay, box: HTMLElement): { x: number; y: number } {
  const w = box.clientWidth;
  const h = box.clientHeight;
  let x = w / 2 - BAR_W / 2;
  let y = 8;
  const first = overlay.points[0];
  if (first) {
    const px = chart.convertToPixel(first, { paneId: overlay.paneId, absolute: true }) as Partial<Coordinate>;
    if (typeof px.x === "number" && typeof px.y === "number") {
      x = px.x - BAR_W / 2;
      y = px.y - BAR_H - 12;
    }
  }
  return {
    x: Math.min(Math.max(4, x), Math.max(4, w - BAR_W - 4)),
    y: Math.min(Math.max(4, y), Math.max(4, h - BAR_H - 4)),
  };
}

interface DrawingObjectBarProps {
  drawing: DrawingObjectState;
  onChange: (next: DrawingObjectState) => void;
  onLock: () => void;
  onDelete: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function DrawingObjectBar({
  drawing,
  onChange,
  onLock,
  onDelete,
  onPointerEnter,
  onPointerLeave,
}: DrawingObjectBarProps) {
  return (
    <div
      className="absolute z-20 flex items-center gap-1 rounded border border-ex-border-strong bg-ex-panel-2 px-1.5 py-1 shadow-lg"
      style={{ left: drawing.x, top: drawing.y, height: BAR_H }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange({ ...drawing, color: c })}
          className={`h-4 w-4 rounded-sm border ${drawing.color === c ? "border-white" : "border-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-ex-border-strong" />
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          title={`${s}px`}
          onClick={() => onChange({ ...drawing, size: s })}
          className={`flex h-6 w-6 items-center justify-center rounded ${drawing.size === s ? "bg-ex-border-strong" : "hover:bg-ex-border"}`}
        >
          <span className="w-3.5 bg-ex-text" style={{ height: s }} />
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-ex-border-strong" />
      <button
        type="button"
        onClick={onLock}
        className="rounded px-1.5 py-0.5 text-[11px] text-ex-text hover:bg-ex-border"
      >
        {drawing.locked ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded px-1.5 py-0.5 text-[11px] text-ex-down hover:bg-ex-border"
      >
        Delete
      </button>
    </div>
  );
}
