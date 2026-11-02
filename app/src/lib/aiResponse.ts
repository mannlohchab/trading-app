export type InlineText = { text: string; style?: 'bold' | 'italic' | 'code' };
export type ResponseBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'divider';
  content: string;
  level?: number;
  marker?: string;
  depth?: number;
};

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
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
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
