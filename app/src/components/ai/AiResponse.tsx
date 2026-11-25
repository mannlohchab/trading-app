import { memo, useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { makeStyles } from '@/hooks/use-theme';
import { cellTone, isNumericCell, parseInline, parseResponse, plainCell, type ResponseBlock } from '@/lib/aiResponse';

function Inline({ content }: { content: string }) {
  const styles = useStyles();
  return <>{parseInline(content).map((part, index) => (
    <Text key={index} style={part.style ? styles[part.style] : undefined}>{part.text}</Text>
  ))}</>;
}

/** Column width from its longest cell: short figures stay narrow, prose wraps at a readable width. */
const columnWidth = (cells: string[]) =>
  Math.min(210, Math.max(64, Math.max(...cells.map(cell => plainCell(cell).length)) * 7.6 + 24));

function Table({ block }: { block: ResponseBlock }) {
  const styles = useStyles();
  const header = block.header ?? [];
  const rows = block.rows ?? [];
  const columns = header.map((title, c) => {
    const cells = rows.map(row => row[c] ?? '');
    const filled = cells.filter(cell => plainCell(cell));
    const numeric = filled.length > 0 && filled.every(isNumericCell);
    return { width: columnWidth([title, ...cells]), align: block.align?.[c] ?? (numeric && c > 0 ? 'right' : 'left') };
  });
  const cellBox = (c: number) => ({ flexBasis: columns[c]!.width, minWidth: columns[c]!.width });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll} contentContainerStyle={styles.tableContent}
      accessibilityLabel={`Table: ${header.map(plainCell).join(', ')}`}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          {header.map((title, c) => (
            <Text key={c} style={[styles.cell, styles.headerCell, cellBox(c), { textAlign: columns[c]!.align }]}>{plainCell(title)}</Text>
          ))}
        </View>
        {rows.map((row, r) => (
          <View key={r} style={[styles.tableRow, r < rows.length - 1 && styles.rowDivider, r % 2 === 1 && styles.altRow]}>
            {row.map((cell, c) => {
              const tone = c > 0 ? cellTone(cell) : undefined;
              return (
                <Text key={c} selectable style={[styles.cell, cellBox(c), { textAlign: columns[c]!.align },
                  c === 0 && styles.firstCell, columns[c]!.align === 'right' && styles.numberCell, tone && styles[tone]]}>
                  {tone ? plainCell(cell) : <Inline content={cell} />}
                </Text>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export const AiResponse = memo(function AiResponse({ content }: { content: string }) {
  const styles = useStyles();
  const blocks = useMemo(() => parseResponse(content), [content]);
  return <View style={styles.body}>
    {blocks.map((block, index) => {
      if (block.type === 'divider') return <View key={index} style={styles.divider} />;
      if (block.type === 'table') return <Table key={index} block={block} />;
      // The assistant explains strategies in words and charts, never as raw code or JSON. The
      // backend strips code from new replies; this also hides it in replies saved before that.
      if (block.type === 'code') return null;
      if (block.type === 'list') return <View key={index} style={[styles.list, { marginLeft: (block.depth ?? 0) * 14 }]}>
        <Text style={styles.marker}>{block.marker}</Text>
        <Text selectable style={[styles.text, styles.listText]}><Inline content={block.content} /></Text>
      </View>;
      if (block.type === 'quote') return <View key={index} style={styles.quote}>
        <Text selectable style={[styles.text, styles.quoteText]}><Inline content={block.content} /></Text>
      </View>;
      const heading = block.type === 'heading';
      const note = /^\*?Educational only\./.test(block.content);
      return <Text key={index} selectable accessibilityRole={heading ? 'header' : undefined}
        style={[styles.text, heading && styles.heading, heading && block.level === 1 && styles.title, note && styles.note]}>
        <Inline content={block.content} />
      </Text>;
    })}
  </View>;
});

const useStyles = makeStyles((_Palette, P, scheme) => ({
  body: { gap: 10, paddingTop: 2, paddingBottom: 2 },
  text: { color: P.body, fontSize: 14, lineHeight: 22 },
  heading: { color: P.text, fontSize: 16, lineHeight: 23, fontWeight: '700', marginTop: 8 },
  title: { fontSize: 20, lineHeight: 28 },
  bold: { fontWeight: '700', color: P.text },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: P.soft },
  list: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  marker: { minWidth: 14, color: P.body, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  listText: { flex: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: P.border, backgroundColor: 'transparent', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 4 },
  quoteText: { fontSize: 13, lineHeight: 21, color: P.textSecondary },
  divider: { height: 1, backgroundColor: P.border, marginTop: 4 },
  note: { fontSize: 11, lineHeight: 18, color: P.textMuted },
  // Tables bleed to the screen edge while scrolling sideways, but line up with the text at rest
  // (offsets match the chat list's 20px padding and the reply's 8px right inset in the AI screen).
  tableScroll: { marginLeft: -20, marginRight: -28, marginVertical: 4 },
  tableContent: { flexGrow: 1, paddingLeft: 20, paddingRight: 28 },
  table: { flexGrow: 1, borderWidth: 1, borderColor: P.border, borderRadius: 12, overflow: 'hidden', backgroundColor: P.card },
  tableRow: { flexDirection: 'row' },
  tableHeader: { backgroundColor: P.soft, borderBottomWidth: 1, borderBottomColor: P.border },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  altRow: { backgroundColor: scheme === 'dark' ? '#181817' : '#FAFAF8' },
  cell: { flexGrow: 1, flexShrink: 0, paddingHorizontal: 11, paddingVertical: 9, color: P.body, fontSize: 13, lineHeight: 19 },
  headerCell: { color: P.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  firstCell: { color: P.text, fontWeight: '600' },
  numberCell: { fontVariant: ['tabular-nums'] },
  up: { color: scheme === 'dark' ? '#4ADE80' : '#15803D', fontWeight: '600' },
  down: { color: scheme === 'dark' ? '#F87171' : '#B91C1C', fontWeight: '600' },
}));
