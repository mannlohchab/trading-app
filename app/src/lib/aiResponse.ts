export type InlineText = { text: string; style?: 'bold' | 'italic' | 'code' };
export type CellAlign = 'left' | 'center' | 'right';
export type ResponseBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'divider' | 'table';
  content: string;
  level?: number;
  marker?: string;
  depth?: number;
  /** Tables: header cells, body rows (padded to the header's width) and per-column alignment. */
  header?: string[];
  rows?: string[][];
  align?: (CellAlign | null)[];
};

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const isSeparatorRow = (line: string) => isTableRow(line) && splitRow(line).every(cell => /^:?-+:?$/.test(cell));
const alignOf = (cell: string): CellAlign | null =>
  cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null;

/** Cell text without emphasis markers, for measuring and classifying. */
export const plainCell = (cell: string) => cell.replace(/\*\*|__|`/g, '').replace(/\*/g, '').trim();

const SIGNED = /^([+\-−–])\s?[$₹€£]?\s?\d[\d.,\s]*\s?(%|USDT|USD|x)?$/i;
const NUMERIC = /^[+\-−–]?\s?[$₹€£≈~]?\s?\d[\d.,\s]*\s?(%|USDT|USD|x|days?|d)?$/i;

/** Numbers line up on the right: "+1 902", "-7 %", "84.9 %", "₹2,900". */
export const isNumericCell = (cell: string) => NUMERIC.test(plainCell(cell));

/** Signed numbers get a tone: "+6.3 %" is up, "–270" is down. */
export function cellTone(cell: string): 'up' | 'down' | undefined {
  const match = SIGNED.exec(plainCell(cell));
  if (!match || /^[+\-−–]?\s?[$₹€£]?\s?0+([.,]0+)?\s?%?$/.test(plainCell(cell))) return undefined;
  return match[1] === '+' ? 'up' : 'down';
}

// Native text only: no HTML or executable links. Unfinished delimiters stay visible.
export function parseInline(content: string): InlineText[] {
  const parts: InlineText[] = [];
  const pattern = /\*\*(\S(?:[\s\S]*?\S)?)\*\*|__(\S(?:[\s\S]*?\S)?)__|`([^`]+)`|\*([^*\n]+)\*/g;
  let end = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index! > end) parts.push({ text: content.slice(end, match.index) });
    parts.push({ text: match[1] ?? match[2] ?? match[3] ?? match[4],
      style: match[1] !== undefined || match[2] !== undefined ? 'bold' : match[3] !== undefined ? 'code' : 'italic' });
    end = match.index! + match[0].length;
  }
  if (end < content.length) parts.push({ text: content.slice(end) });
  return parts;
}

export function parseResponse(content: string): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | undefined;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', content: paragraph.join('\n') });
    paragraph = [];
  };
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // A table is a pipe row followed by a |---| separator row (while streaming, the header waits as text).
    if (!code && isTableRow(line) && lines[i + 1] !== undefined && isSeparatorRow(lines[i + 1]!)) {
      flush();
      const header = splitRow(line);
      const align = header.map((_, c) => alignOf(splitRow(lines[i + 1]!)[c] ?? ''));
      const rows: string[][] = [];
      // Body rows only need a leading pipe, so the row being streamed shows in the table at once.
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]!); i++) {
        const cells = splitRow(lines[i]!);
        rows.push(header.map((_, c) => cells[c] ?? ''));
      }
      i--;
      blocks.push({ type: 'table', content: '', header, rows, align });
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      if (code) { blocks.push({ type: 'code', content: code.join('\n') }); code = undefined; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const list = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', content: heading[2], level: heading[1].length }); }
    else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'divider', content: '' }); }
    else if (list) {
      flush(); blocks.push({ type: 'list', content: list[3], marker: /^\d/.test(list[2]) ? list[2] : '•', depth: Math.min(3, Math.floor(list[1].length / 2)) });
    } else if (quote) { flush(); blocks.push({ type: 'quote', content: quote[1] }); }
    else paragraph.push(line);
  }
  flush();
  if (code) blocks.push({ type: 'code', content: code.join('\n') });
  return blocks;
}
