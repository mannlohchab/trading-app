import { memo, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { parseInline, parseResponse } from '@/lib/aiResponse';

function Inline({ content }: { content: string }) {
  return <>{parseInline(content).map((part, index) => (
    <Text key={index} style={part.style ? styles[part.style] : undefined}>{part.text}</Text>
  ))}</>;
}

export const AiResponse = memo(function AiResponse({ content }: { content: string }) {
  const blocks = useMemo(() => parseResponse(content), [content]);
  return <View style={styles.body}>
    {blocks.map((block, index) => {
      if (block.type === 'divider') return <View key={index} style={styles.divider} />;
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

const styles = StyleSheet.create({
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
});
