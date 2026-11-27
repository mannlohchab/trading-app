import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DRAWING_GROUPS,
  type DrawingGroup,
  type DrawingTool,
} from "./drawing-tools";

interface DrawingToolbarProps {
  /** Overlay name currently armed for drawing, or null for the cursor. */
  activeTool: string | null;
  onSelectTool: (name: string) => void;
  onCursor: () => void;
  magnet: boolean;
  onMagnetChange: (on: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
}

function groupTools(group: DrawingGroup): DrawingTool[] {
  return group.sections?.flatMap((s) => s.tools) ?? group.tools;
}

export function DrawingToolbar({
  activeTool,
  onSelectTool,
  onCursor,
  magnet,
  onMagnetChange,
  onUndo,
  onClear,
}: DrawingToolbarProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lastTool, setLastTool] = useState<Record<string, string>>({});
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (openGroup === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openGroup]);

  const pick = (groupId: string, tool: DrawingTool) => {
    setLastTool((prev) => ({ ...prev, [groupId]: tool.name }));
    setOpenGroup(null);
    onSelectTool(tool.name);
  };

  return (
    <aside
      ref={railRef}
      className="relative z-30 flex w-12 shrink-0 flex-col items-center border-r border-chart-border bg-chart-bg py-1.5"
    >
      <div className="flex flex-1 flex-col items-center gap-0.5">
        <RailButton
          label="Cursor"
          active={activeTool === null}
          onClick={() => {
            setOpenGroup(null);
            onCursor();
          }}
        >
          <path d="M12 3v7M12 14v7M3 12h7M14 12h7" />
        </RailButton>

        {DRAWING_GROUPS.map((group) => {
          const tools = groupTools(group);
          const remembered =
            tools.find((tool) => tool.name === lastTool[group.id]) ?? tools[0];
          const groupActive = tools.some((tool) => tool.name === activeTool);
          const shown =
            tools.find((tool) => tool.name === activeTool) ?? remembered;
          const sections = group.sections ?? [
            { label: group.label, tools: group.tools },
          ];
          const hasMenu = tools.length > 1;

          return (
            <div key={group.id} className="relative">
              <RailButton
                label={`${group.label} — ${shown.label}`}
                active={groupActive}
                hasMenu={hasMenu}
                onClick={() =>
                  hasMenu
                    ? setOpenGroup((cur) => (cur === group.id ? null : group.id))
                    : pick(group.id, tools[0])
                }
              >
                {shown.icon}
              </RailButton>

              {openGroup === group.id && (
                <div className="absolute left-[calc(100%+6px)] top-0 z-40 w-[240px] overflow-hidden rounded-md border border-[#2a2e39] bg-black py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                  {sections.map((section, index) => (
                    <div
                      key={section.label}
                      className={
                        index > 0 ? "mt-1 border-t border-[#2a2e39] pt-1" : ""
                      }
                    >
                      <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#787b86]">
                        {section.label}
                      </div>
                      {section.tools.map((tool) => (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => pick(group.id, tool)}
                          className={`flex w-full items-center gap-2.5 px-3 py-[6px] text-left text-[13px] ${
                            activeTool === tool.name
                              ? "bg-[#2a2e39] text-[#d1d4dc]"
                              : "text-[#d1d4dc] hover:bg-[#2a2e39]"
                          }`}
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center text-[#d1d4dc]">
                            <ToolSvg>{tool.icon}</ToolSvg>
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {tool.label}
                          </span>
                          {tool.shortcut && (
                            <span className="shrink-0 text-[11px] text-[#787b86]">
                              {tool.shortcut}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-0.5 border-t border-chart-border pt-1">
        <RailButton
          label="Magnet (snap to OHLC)"
          active={magnet}
          onClick={() => onMagnetChange(!magnet)}
        >
          <path d="M8 4v8a4 4 0 0 0 8 0V4M8 4H6m10 0h2M6 8h2m8 0h2" />
        </RailButton>
        <RailButton label="Remove last drawing" onClick={onUndo}>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a5 5 0 0 1 0 10h-1" />
        </RailButton>
        <RailButton label="Clear drawings" onClick={onClear}>
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </RailButton>
      </div>
    </aside>
  );
}

function RailButton({
  label,
  active,
  hasMenu,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  hasMenu?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-md ${
        active
          ? "bg-[#2a2e39] text-[#d1d4dc]"
          : "text-[#787b86] hover:bg-[#1e222d] hover:text-[#d1d4dc]"
      }`}
    >
      <ToolSvg>{children}</ToolSvg>
      {hasMenu && (
        <span className="pointer-events-none absolute bottom-[3px] right-[3px] border-y-[3px] border-l-[4px] border-y-transparent border-l-current opacity-70" />
      )}
    </button>
  );
}

function ToolSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
