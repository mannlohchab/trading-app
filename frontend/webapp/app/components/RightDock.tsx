interface RightDockProps {
  orderOpen: boolean;
  onToggleOrder: () => void;
}

function DockButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`w-full rounded px-1 py-2 text-[10px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl] ${
        active ? "bg-ex-panel-2 text-ex-text" : "text-ex-muted hover:text-ex-text"
      }`}
    >
      {label}
    </button>
  );
}

export function RightDock({ orderOpen, onToggleOrder }: RightDockProps) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-l border-ex-border bg-ex-panel p-1">
      <DockButton active={orderOpen} label="Trade" onClick={onToggleOrder} />
    </div>
  );
}
