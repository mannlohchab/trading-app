import { registerOverlay, type Coordinate, type OverlayFigure } from "klinecharts";
import type { ReactNode } from "react";

export interface DrawingTool {
  /** KLineChart overlay name (see `getSupportedOverlays()`). */
  name: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
}

export interface DrawingSection {
  label: string;
  tools: DrawingTool[];
}

export interface DrawingGroup {
  id: string;
  label: string;
  icon: ReactNode;
  tools: DrawingTool[];
  sections?: DrawingSection[];
}

let registered = false;

/**
 * KLineChart ships lines, channels, fibonacci, brush and annotations, but no
 * rectangle — register one from the built-in `polygon` figure. Styling comes
 * from `styles.overlay.polygon` so it follows the chart theme.
 */
export function registerCustomOverlays(): void {
  if (registered) return;
  registered = true;

  registerOverlay({
    name: "rect",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [start, end] = coordinates;
      const corners: Coordinate[] = [
        start,
        { x: end.x, y: start.y },
        end,
        { x: start.x, y: end.y },
      ];
      return [{ type: "polygon", attrs: { coordinates: corners } }];
    },
  });
}

export const DRAWING_GROUPS: DrawingGroup[] = [
  {
    id: "trend",
    label: "Trend tools",
    icon: <path d="M4 18L20 6" />,
    tools: [],
    sections: [
      {
        label: "Lines",
        tools: [
          {
            name: "segment",
            label: "Trendline",
            shortcut: "Alt + T",
            icon: <path d="M4 18 20 6" />,
          },
          {
            name: "rayLine",
            label: "Ray",
            icon: (
              <>
                <path d="M4 18 20 6" />
                <circle cx="4" cy="18" r="1.6" />
              </>
            ),
          },
          {
            name: "straightLine",
            label: "Extended line",
            icon: (
              <>
                <path d="M2 20 22 4" />
                <circle cx="8" cy="15.5" r="1.4" />
                <circle cx="16" cy="9.5" r="1.4" />
              </>
            ),
          },
          {
            name: "horizontalStraightLine",
            label: "Horizontal line",
            shortcut: "Alt + H",
            icon: <path d="M3 12h18" />,
          },
          {
            name: "horizontalRayLine",
            label: "Horizontal ray",
            shortcut: "Alt + J",
            icon: (
              <>
                <path d="M5 12h15" />
                <circle cx="5" cy="12" r="1.6" />
              </>
            ),
          },
          {
            name: "verticalStraightLine",
            label: "Vertical line",
            shortcut: "Alt + V",
            icon: <path d="M12 3v18" />,
          },
          {
            name: "horizontalSegment",
            label: "Horizontal segment",
            icon: (
              <>
                <path d="M5 12h14" />
                <path d="M5 9.5v5M19 9.5v5" />
              </>
            ),
          },
          {
            name: "verticalSegment",
            label: "Vertical segment",
            icon: (
              <>
                <path d="M12 5v14" />
                <path d="M9.5 5h5M9.5 19h5" />
              </>
            ),
          },
          {
            name: "verticalRayLine",
            label: "Vertical ray",
            icon: (
              <>
                <path d="M12 19V4" />
                <circle cx="12" cy="19" r="1.6" />
              </>
            ),
          },
        ],
      },
      {
        label: "Channels",
        tools: [
          {
            name: "parallelStraightLine",
            label: "Parallel channel",
            icon: (
              <>
                <path d="M3 15 15 5" />
                <path d="M9 19 21 9" />
              </>
            ),
          },
          {
            name: "priceChannelLine",
            label: "Price channel",
            icon: (
              <>
                <path d="M3 16 15 6" />
                <path d="M6 19 18 9" opacity=".55" />
                <path d="M9 21 21 11" />
              </>
            ),
          },
        ],
      },
    ],
  },
  {
    id: "fib",
    label: "Fibonacci",
    icon: (
      <>
        <path d="M4 5h16M4 9h16M4 13h16M4 17h16" />
        <path d="M4 5l16 12" opacity=".45" />
      </>
    ),
    tools: [
      {
        name: "fibonacciLine",
        label: "Fib retracement",
        icon: (
          <>
            <path d="M4 5h16M4 9h16M4 13h16M4 17h16" />
            <path d="M4 5l16 12" opacity=".45" />
          </>
        ),
      },
    ],
  },
  {
    id: "shapes",
    label: "Shapes",
    icon: <rect x="4" y="6" width="16" height="12" rx="1" />,
    tools: [
      {
        name: "rect",
        label: "Rectangle",
        icon: <rect x="4" y="6" width="16" height="12" rx="1" />,
      },
      {
        name: "brush",
        label: "Brush",
        icon: (
          <path d="M5 19c2-1 4-4 6-8l3 3c-4 2-7 4-9 5zm9-10 3-3 3 3-3 3-3-3z" />
        ),
      },
    ],
  },
  {
    id: "notes",
    label: "Text",
    icon: (
      <>
        <path d="M6 6h12M12 6v12" />
        <path d="M8 18h8" />
      </>
    ),
    tools: [
      {
        name: "simpleAnnotation",
        label: "Annotation",
        icon: (
          <>
            <path d="M12 20V9" />
            <path d="M8.5 12.5 12 9l3.5 3.5" />
            <path d="M5 5h14" />
          </>
        ),
      },
      {
        name: "simpleTag",
        label: "Price tag",
        icon: (
          <>
            <path d="M3 12h13" />
            <path d="M16 8.5h5v7h-5l-2-3.5z" />
          </>
        ),
      },
      {
        name: "priceLine",
        label: "Price line",
        icon: (
          <>
            <path d="M3 14h18" strokeDasharray="3 2.5" />
            <path d="M5 9h7" />
          </>
        ),
      },
    ],
  },
];

/** Flat lookup used to label the active tool. */
export const DRAWING_TOOLS: DrawingTool[] = DRAWING_GROUPS.flatMap(
  (group) => group.sections?.flatMap((s) => s.tools) ?? group.tools,
);
