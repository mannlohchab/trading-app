// How a saved run (backtest, research experiment, live paper test) looks as a ticket card.
// Pure: colors and labels from status and result, so every list shows runs the same way.

/** Header band: what happened, at a glance. */
export type BandTone = 'progress' | 'gain' | 'loss' | 'attention' | 'neutral';
/** Status pill. */
export type PillTone = 'progress' | 'live' | 'done' | 'failed' | 'muted';

export const BAND: Record<BandTone, { background: string; text: string }> = {
  progress: { background: '#7387F9', text: '#FFFFFF' },
  gain: { background: '#8BF0C6', text: '#0B1B14' },
  loss: { background: '#F5B6E3', text: '#2A0F22' },
  attention: { background: '#F2F884', text: '#1F1F0A' },
  neutral: { background: '#DDE1EA', text: '#1F2430' },
};

export const PILL: Record<PillTone, { background: string; text: string }> = {
  progress: { background: '#E7ECFF', text: '#5468E8' },
  live: { background: '#E1F7EE', text: '#0A8A63' },
  done: { background: '#FFF4E0', text: '#E59A12' },
  failed: { background: '#FDECEC', text: '#D12C2C' },
  muted: { background: '#EEF0F4', text: '#5F6675' },
};

const STATUS: Record<string, { label: string; pill: PillTone }> = {
  PENDING: { label: 'Queued', pill: 'progress' },
  CREATED: { label: 'Starting', pill: 'progress' },
  RUNNING: { label: 'Running', pill: 'progress' },
  COMPLETED: { label: 'Completed', pill: 'done' },
  PAUSED: { label: 'Paused', pill: 'muted' },
  STOPPED: { label: 'Stopped', pill: 'muted' },
  CANCELLED: { label: 'Cancelled', pill: 'muted' },
  FAILED: { label: 'Failed', pill: 'failed' },
};

const finite = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Live paper tests that are running read as "Live", in green. */
export function statusPill(status: string, kind: 'backtest' | 'experiment' | 'paper' = 'backtest'): { label: string; tone: PillTone } {
  if (kind === 'paper' && status === 'RUNNING') return { label: 'Live', tone: 'live' };
  const known = STATUS[status];
  return known ? { label: known.label, tone: known.pill } : { label: status.charAt(0) + status.slice(1).toLowerCase(), tone: 'muted' };
}

/** Band color: in progress, profit, loss, failed, or nothing to judge yet. */
export function bandTone(status: string, returnPercent?: unknown): BandTone {
  if (status === 'FAILED') return 'attention';
  if (status === 'PENDING' || status === 'CREATED' || status === 'RUNNING') {
    const r = finite(returnPercent);
    return r === null ? 'progress' : r >= 0 ? 'gain' : 'loss';
  }
  const r = finite(returnPercent);
  if (r === null) return 'neutral';
  return r >= 0 ? 'gain' : 'loss';
}

/** "+4.26%" / "−3.10%" (true minus sign), or null when there is no number. */
export function signedPercent(value: unknown, digits = 2): string | null {
  const n = finite(value);
  if (n === null) return null;
  const text = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}%`;
}

/** DD/MM/YYYY in the viewer's time zone. */
export function ticketDate(value: string | number | Date | null | undefined): string {
  if (value == null) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** "BTCUSDT · 1h" for the header band. */
export const ticketMarket = (market?: { symbol?: string; timeframe?: string }) =>
  [market?.symbol, market?.timeframe].filter(Boolean).join(' · ') || 'Backtest';
