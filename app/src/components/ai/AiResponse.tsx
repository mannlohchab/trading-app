import { memo, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
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
      if (block.type === 'code') return <View key={index} style={styles.codeBlock}>
        <Text selectable style={[styles.text, styles.code]}>{block.content}</Text>
      </View>;
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
  text: { color: '#3D3D3A', fontSize: 14, lineHeight: 22 },
  heading: { color: '#1F1F1E', fontSize: 16, lineHeight: 23, fontWeight: '700', marginTop: 8 },
  title: { fontSize: 20, lineHeight: 28 },
  bold: { fontWeight: '700', color: '#1F1F1E' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: '#EDEDEA' },
  codeBlock: { backgroundColor: '#EFEFEC', borderRadius: 12, padding: 14 },
  list: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  marker: { minWidth: 14, color: '#3D3D3A', fontSize: 14, lineHeight: 22, fontWeight: '600' },
  listText: { flex: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: '#C9C9C4', backgroundColor: 'transparent', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 4 },
  quoteText: { fontSize: 13, lineHeight: 21, color: '#6B6B67' },
  divider: { height: 1, backgroundColor: '#E6E6E2', marginTop: 4 },
  note: { fontSize: 11, lineHeight: 18, color: '#8A8A86' },
});
