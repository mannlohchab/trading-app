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
  body: { gap: 12, paddingTop: 3, paddingBottom: 4 },
  text: { color: '#393D45', fontSize: 15, lineHeight: 25 },
  heading: { color: '#202126', fontSize: 17, lineHeight: 25, fontWeight: '700', marginTop: 8 },
  title: { fontSize: 20, lineHeight: 28 },
  bold: { fontWeight: '700', color: '#252936' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: '#F2F1F7' },
  codeBlock: { backgroundColor: '#F5F4F8', borderRadius: 12, padding: 14 },
  list: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  marker: { minWidth: 18, color: '#6B78A6', fontSize: 15, lineHeight: 25, fontWeight: '600' },
  listText: { flex: 1 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#B7C2E7', backgroundColor: '#F7F5FA', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 4 },
  quoteText: { fontSize: 13, lineHeight: 21, color: '#606472' },
  divider: { height: 1, backgroundColor: '#EDEAF1', marginTop: 4 },
  note: { fontSize: 11, lineHeight: 18, color: '#80838D' },
});
