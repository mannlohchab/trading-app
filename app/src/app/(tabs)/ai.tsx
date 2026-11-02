import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassIcon, GlassPressable, type GlassIconName } from '@/components/ui/GlassIcon';
import { Palette } from '@/constants/theme';
import { api, streamAiChat } from '@/lib/api';
import { createAiRequestGate, type AiKind } from '@/lib/aiChat';
import { useAuth } from '@/store/auth';
import { AiResponse } from '@/components/ai/AiResponse';

type Message = { id: string; role: 'user' | 'assistant'; content: string; status?: 'streaming' | 'stopped' | 'error' };
type Conversation = { id: string; title: string; kind: AiKind; updatedAt: string };
const MODES: { kind: AiKind; label: string; icon: GlassIconName }[] = [
  { kind: 'chat', label: 'Chat', icon: 'community' },
  { kind: 'analysis', label: 'Market', icon: 'chart' },
  { kind: 'portfolio', label: 'Portfolio', icon: 'wallet' },
];
const STARTERS = [
  { title: 'Check Bitcoin right now', prompt: 'What is Bitcoin trading at right now? Show the latest available price and daily change.', icon: 'chart' as const },
  { title: 'Compare two markets', prompt: 'Compare the latest Bitcoin and Ethereum prices and daily changes. What should I watch?', icon: 'analytics' as const },
];
const INK = '#1E293B';
const MUTED = '#737780';

export default function AiScreen() {
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AiKind>('chat');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [title, setTitle] = useState('New conversation');
  const [streaming, setStreaming] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string>();
  const [needsNewChat, setNeedsNewChat] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const drawerClosing = useRef(false);
  const drawerWidth = Math.min(useWindowDimensions().width * 0.88, 370);
  const [search, setSearch] = useState('');
  const gate = useRef(createAiRequestGate()).current;
  const listRef = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const activeAssistant = useRef<string | undefined>(undefined);
  const historyKey = ['ai-conversations', userId];

  useEffect(() => () => gate.reset(), [gate]);
  useEffect(() => () => drawerProgress.stopAnimation(), [drawerProgress]);

  function showDrawer() {
    Keyboard.dismiss();
    drawerClosing.current = false;
    drawerProgress.stopAnimation();
    drawerProgress.setValue(0);
    setDrawerOpen(true);
  }

  function animateDrawerIn() {
    if (drawerClosing.current) return;
    Animated.timing(drawerProgress, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web',
    }).start();
  }

  function closeDrawer() {
    Keyboard.dismiss();
    drawerClosing.current = true;
    drawerProgress.stopAnimation();
    Animated.timing(drawerProgress, {
      toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setDrawerOpen(false);
    });
  }

  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => api<{ conversations: Conversation[] }>('/api/ai/conversations', { signal }),
    enabled: drawerOpen,
    staleTime: 0,
  });

  function reset(nextKind = kind, nextSymbol = symbol) {
    gate.reset();
    setStreaming(false);
    setLoadingConversation(false);
    setKind(nextKind);
    setSymbol(nextSymbol);
    setMessages([]);
    setConversationId(undefined);
    setTitle('New conversation');
    setInput('');
    setError(undefined);
    setNeedsNewChat(false);
    activeAssistant.current = undefined;
    nearBottom.current = true;
  }

  function newChat() {
    reset(kind, symbol || 'BTCUSDT');
    closeDrawer();
  }

  async function openConversation(conversation: Conversation) {
    reset(conversation.kind, conversation.kind === 'analysis' ? '' : symbol);
    closeDrawer();
    setTitle(conversation.title);
    setLoadingConversation(true);
    const request = gate.begin();
    if (!request) return;
    try {
      const result = await api<{ conversation: Conversation; messages: Message[] }>(
        `/api/ai/conversations/${encodeURIComponent(conversation.id)}`, { signal: request.signal },
      );
      if (!gate.isCurrent(request)) return;
      setConversationId(result.conversation.id);
      setMessages(result.messages.filter((message) => message.role === 'user' || message.role === 'assistant'));
    } catch (err) {
      if (gate.isCurrent(request)) setError(err instanceof Error ? err.message : 'Could not open this conversation.');
    } finally {
      if (gate.isCurrent(request)) setLoadingConversation(false);
      gate.finish(request);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 4000 || loadingConversation || needsNewChat || (kind === 'analysis' && !symbol.trim())) return;
    const request = gate.begin();
    if (!request) return;
    const assistantId = `assistant-${Date.now()}`;
    activeAssistant.current = assistantId;
    setMessages((previous) => [...previous,
      { id: `user-${Date.now()}`, role: 'user', content: trimmed },
      { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
    ]);
    if (!messages.length) setTitle(trimmed);
    setInput('');
    setError(undefined);
    setStreaming(true);
    nearBottom.current = true;
    try {
      await streamAiChat({
        conversationId, message: trimmed, kind,
        ...(kind === 'analysis' ? { symbol: symbol.trim().toUpperCase(), exchange: symbol.includes('/') || /^(EURUSD|GBPUSD|USDJPY|USDCHF|AUDUSD|USDCAD|NZDUSD)$/i.test(symbol.trim()) ? 'FOREX' : 'BINANCE' } : {}),
      }, (event) => {
        if (!gate.isCurrent(request)) return;
        if (event.type === 'meta' && event.conversationId) setConversationId(event.conversationId);
        if (event.type === 'token' && event.content) {
          setMessages((previous) => previous.map((message) => message.id === assistantId
            ? { ...message, content: message.content + event.content } : message));
        }
      }, request.signal);
      if (gate.isCurrent(request)) {
        setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: undefined } : message));
      }
    } catch (err) {
      if (gate.isCurrent(request)) {
        setError(err instanceof Error ? err.message : 'Could not get a response. Please start a new chat.');
        setNeedsNewChat(true);
        setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: 'error' } : message));
      }
    } finally {
      if (gate.isCurrent(request)) {
        setStreaming(false);
        activeAssistant.current = undefined;
      }
      gate.finish(request);
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', userId] });
    }
  }

  function stopResponse() {
    const assistantId = activeAssistant.current;
    gate.reset();
    setStreaming(false);
    setNeedsNewChat(true);
    setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: 'stopped' } : message));
    activeAssistant.current = undefined;
  }

  const history = (historyQuery.data?.conversations ?? []).filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()));
  const disabled = loadingConversation || needsNewChat || (kind === 'analysis' && !symbol.trim());

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <GlassPressable accessibilityRole="button" accessibilityLabel="Open conversation history" style={styles.iconButton}
            onPress={showDrawer}>
            <View style={styles.menuGlyph}><View style={styles.menuLine} /><View style={[styles.menuLine, { width: 12 }]} /></View>
          </GlassPressable>
          <View style={styles.headerTitle}><Text style={styles.title}>AI Insight</Text>{(messages.length > 0 || loadingConversation) && <Text style={styles.headerSubtitle} numberOfLines={1}>{title}</Text>}</View>
          <GlassPressable accessibilityRole="button" accessibilityLabel="Start a new chat" style={styles.iconButton} onPress={newChat}>
            <GlassIcon name="add" size={26} />
          </GlassPressable>
        </View>

        <View style={styles.panel}>
          {kind === 'analysis' && (
            <View style={styles.instrumentSection}>
              <View style={styles.instrumentRow}>
                <Text style={styles.exchange}>{symbol.includes('/') ? 'FOREX' : 'CRYPTO'}</Text>
                <TextInput accessibilityLabel="Market pair symbol" value={symbol} placeholder="BTCUSDT or EUR/USD" placeholderTextColor={MUTED}
                  onChangeText={(value) => reset('analysis', value.toUpperCase().replace(/\s/g, ''))}
                  style={styles.symbolInput} autoCapitalize="characters" autoCorrect={false} maxLength={30} />
                <GlassPressable accessibilityRole="button" disabled={streaming || !symbol.trim() || loadingConversation || needsNewChat}
                  onPress={() => send(`Provide a structured technical and contextual analysis for ${symbol.trim().toUpperCase()}.`)}
                  style={[styles.analyzeButton, (streaming || disabled) && styles.disabled]}>
                  <Text style={styles.analyzeText}>Analyze</Text><GlassIcon name="chart" size={20} />
                </GlassPressable>
              </View>
              {!symbol && <Text style={styles.instrumentHint}>Choose a symbol to start a new analysis.</Text>}
            </View>
          )}

          <FlatList ref={listRef} style={styles.flex} data={messages} keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.messages, !messages.length && styles.emptyList]}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
            onScroll={({ nativeEvent }) => { nearBottom.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y < 100; }}
            scrollEventThrottle={100}
            onContentSizeChange={() => { if (messages.length && nearBottom.current) listRef.current?.scrollToEnd({ animated: false }); }}
            ListEmptyComponent={loadingConversation ? <View style={styles.loading}><ActivityIndicator color={Palette.accent} /><Text style={styles.muted}>Opening conversation…</Text></View> : (
              <View style={styles.welcome}>
                <View style={styles.heroIcon}><GlassIcon name="analytics" size={38} tone="purple" /></View>
                <Text style={styles.welcomeTitle}>{kind === 'portfolio' ? 'Know your portfolio' : kind === 'analysis' ? 'Explore a pair' : 'How can I help?'}</Text>
                <Text style={styles.welcomeSubtitle}>{kind === 'portfolio' ? 'Understand your allocation and risk.' : kind === 'analysis' ? 'Choose a symbol above to get started.' : 'Ask about markets, trading, or your portfolio.'}</Text>
                {kind === 'chat' && <View style={styles.starterCards}>{STARTERS.map((starter) => (
                  <GlassPressable key={starter.title} accessibilityRole="button" style={styles.starterCard} onPress={() => send(starter.prompt)}>
                    <GlassIcon name={starter.icon} size={22} /><Text style={styles.starterTitle}>{starter.title}</Text>
                  </GlassPressable>
                ))}</View>}
                {kind === 'portfolio' && <GlassPressable accessibilityRole="button" style={styles.portfolioCard}
                  onPress={() => send('Analyze my paper-trading portfolio: allocation, risk, and educational next steps.')}>
                  <GlassIcon name="wallet" size={22} /><Text style={styles.starterTitle}>Review my paper portfolio</Text>
                </GlassPressable>}
              </View>
            )}
            renderItem={({ item }) => item.role === 'user' ? (
              <View style={styles.userMessage}><Text selectable style={styles.messageText}>{item.content}</Text></View>
            ) : (
              <View style={styles.assistantMessage}>
                <View style={styles.assistantLabel}><GlassIcon name="analytics" size={22} /><Text style={styles.assistantName}>AI Insight</Text>
                  {item.status === 'streaming' && <ActivityIndicator size="small" color={Palette.accent} />}</View>
                {!!item.content && <AiResponse content={item.content} />}
                {!item.content && <Text style={styles.muted}>{item.status === 'streaming' ? 'Looking into it…' : item.status === 'stopped' ? 'Response stopped.' : 'No response received.'}</Text>}
                {item.status === 'stopped' && !!item.content && <Text style={styles.responseStatus}>Stopped · partial response</Text>}
                {item.status === 'error' && !!item.content && <Text style={styles.responseStatus}>Incomplete response</Text>}
              </View>
            )} />

          {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
          {needsNewChat && <GlassPressable accessibilityRole="button" style={styles.restart} onPress={newChat}>
            <Text style={styles.restartText}>Start a new chat to continue</Text><GlassIcon name="add" size={20} />
          </GlassPressable>}
          <View style={styles.composerWrap}>
            <View style={styles.composer}>
              <TextInput accessibilityLabel="Message AI Insight" style={styles.input} value={input} onChangeText={setInput}
                editable={!disabled} multiline maxLength={4000} textAlignVertical="top" placeholderTextColor="#92959D"
                placeholder={kind === 'portfolio' ? 'Ask about your paper portfolio…' : kind === 'analysis' ? `Ask about ${symbol || 'an instrument'}…` : 'Ask a question…'} />
              <View style={styles.composerToolbar}>
                <View style={styles.modes}>{MODES.map((mode) => (
                  <GlassPressable key={mode.kind} accessibilityRole="button" accessibilityState={{ selected: kind === mode.kind }}
                    onPress={() => { if (kind !== mode.kind) reset(mode.kind, symbol || 'BTCUSDT'); }}
                    style={[styles.mode, kind === mode.kind && styles.activeMode]}>
                    <Text style={[styles.modeLabel, kind === mode.kind && styles.activeModeLabel]}>{mode.label}</Text>
                  </GlassPressable>
                ))}</View>
                <GlassPressable accessibilityRole="button" accessibilityLabel={streaming ? 'Stop response' : 'Send message'}
                  disabled={!streaming && (disabled || !input.trim())} onPress={streaming ? stopResponse : () => send(input)}
                  style={[styles.sendButton, !streaming && (disabled || !input.trim()) && styles.disabled]}>
                  {streaming ? <View style={styles.stopGlyph} /> : <GlassIcon name="send" size={24} tone="blue" />}
                </GlassPressable>
              </View>
            </View>
            <Text style={styles.disclaimer}>For learning only. AI can make mistakes.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={drawerOpen} animationType="none" transparent onShow={animateDrawerIn} onRequestClose={closeDrawer}>
        <View style={styles.flex}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.modalBackdrop, { opacity: drawerProgress }]}>
            <GlassPressable accessibilityRole="button" accessibilityLabel="Close conversation history" style={StyleSheet.absoluteFill} onPress={closeDrawer}><View /></GlassPressable>
          </Animated.View>
          <Animated.View style={[styles.drawer, { width: drawerWidth, transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }] }]}>
          <SafeAreaView edges={['top', 'bottom', 'left']} style={styles.drawerContent} accessibilityViewIsModal>
            <View style={styles.drawerHeader}><Text style={styles.drawerTitle}>Conversations</Text>
              <GlassPressable accessibilityRole="button" accessibilityLabel="Close conversation history" onPress={closeDrawer} style={styles.iconButton}><Text style={styles.closeGlyph}>×</Text></GlassPressable>
            </View>
            <GlassPressable accessibilityRole="button" style={styles.newChatButton} onPress={newChat}><GlassIcon name="add" size={25} /><Text style={styles.newChatText}>New conversation</Text></GlassPressable>
            <TextInput accessibilityLabel="Search conversations" placeholder="Search conversations…" placeholderTextColor={MUTED} value={search} onChangeText={setSearch} style={styles.historySearch} autoCorrect={false} />
            <View style={styles.historyHeading}><Text style={styles.promptLabel}>Recent</Text>
              <GlassPressable accessibilityRole="button" onPress={() => { void historyQuery.refetch(); }} style={styles.refreshButton}><Text style={styles.refreshText}>Refresh</Text></GlassPressable>
            </View>
            <ScrollView style={styles.flex} contentContainerStyle={styles.historyList} keyboardShouldPersistTaps="handled">
              {historyQuery.isPending && <ActivityIndicator color={Palette.accent} style={styles.historyLoading} />}
              {historyQuery.isError && <Text accessibilityRole="alert" style={styles.errorText}>Could not load conversations. Tap Refresh to retry.</Text>}
              {!historyQuery.isPending && !historyQuery.isError && !history.length && <Text style={styles.emptyHistory}>{search ? 'No matching conversations.' : 'Your conversations will appear here after your first message.'}</Text>}
              {history.map((conversation) => <GlassPressable key={conversation.id} accessibilityRole="button" onPress={() => openConversation(conversation)}
                style={[styles.historyItem, conversation.id === conversationId && styles.activeHistoryItem]}>
                <GlassIcon name={MODES.find((mode) => mode.kind === conversation.kind)?.icon ?? 'community'} size={23} />
                <View style={styles.flex}><Text style={styles.historyTitle} numberOfLines={2}>{conversation.title}</Text><Text style={styles.historyKind}>{MODES.find((mode) => mode.kind === conversation.kind)?.label ?? 'Chat'}</Text></View>
              </GlassPressable>)}
            </ScrollView>
          </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '600', color: INK, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 12, color: MUTED, marginTop: 3 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  menuGlyph: { gap: 6 }, menuLine: { width: 18, height: 1.5, backgroundColor: '#475569', borderRadius: 2 },
  panel: { flex: 1, backgroundColor: '#fff' },
  messages: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, gap: 28 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  welcome: { alignItems: 'center', paddingVertical: 28 },
  heroIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#F6F4FB', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  welcomeTitle: { fontSize: 28, lineHeight: 35, fontWeight: '600', letterSpacing: -0.8, color: INK, textAlign: 'center' },
  welcomeSubtitle: { fontSize: 14, lineHeight: 21, color: MUTED, marginTop: 10, maxWidth: 270, textAlign: 'center' },
  starterCards: { width: '100%', maxWidth: 300, gap: 10, marginTop: 30 },
  starterCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52, borderRadius: 14, backgroundColor: '#F7F7F9' },
  starterTitle: { flex: 1, color: '#475569', fontSize: 13, lineHeight: 20, fontWeight: '500' },
  portfolioCard: { width: '100%', maxWidth: 300, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, minHeight: 52, borderRadius: 14, backgroundColor: '#F7F7F9', marginTop: 30 },
  promptLabel: { fontSize: 12, color: MUTED, fontWeight: '500' },
  userMessage: { alignSelf: 'flex-end', maxWidth: '91%', borderRadius: 16, borderBottomRightRadius: 5, backgroundColor: '#F3F2F7', paddingHorizontal: 15, paddingVertical: 12 },
  messageText: { color: '#334155', fontSize: 15, lineHeight: 24 }, assistantMessage: { gap: 10 },
  assistantLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 }, assistantName: { fontSize: 12, color: INK, fontWeight: '600' },
  responseStatus: { fontSize: 11, color: MUTED, fontStyle: 'italic', marginTop: 3 },
  loading: { paddingVertical: 50, alignItems: 'center', gap: 15 }, muted: { color: MUTED, fontSize: 12 },
  instrumentSection: { paddingHorizontal: 17, paddingTop: 12, paddingBottom: 4 }, instrumentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#EDEEF2', borderRadius: 12, paddingLeft: 12, paddingRight: 5, paddingVertical: 4 },
  exchange: { color: MUTED, fontSize: 10, fontWeight: '600' }, symbolInput: { flex: 1, minWidth: 50, fontSize: 12, color: INK, paddingVertical: 10, paddingHorizontal: 6, minHeight: 40 },
  analyzeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 10, backgroundColor: '#ECF0FA', borderRadius: 8 }, analyzeText: { color: '#0052d6', fontSize: 11, fontWeight: '600' },
  instrumentHint: { fontSize: 10, lineHeight: 16, color: MUTED, paddingTop: 7 },
  composerWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#fff' },
  composer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderWidth: 1, borderColor: '#E8E7ED', borderRadius: 20, backgroundColor: '#FAFAFC' },
  input: { color: INK, fontSize: 15, lineHeight: 22, minHeight: 52, maxHeight: 120, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 12 },
  composerToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  modes: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap' },
  mode: { justifyContent: 'center', paddingHorizontal: 9, minHeight: 44, borderRadius: 12 },
  activeMode: { backgroundColor: '#E9EDF7' },
  modeLabel: { color: '#767982', fontSize: 12, fontWeight: '500' }, activeModeLabel: { color: '#0052D6' },
  sendButton: { width: 44, height: 44, flexShrink: 0, borderRadius: 14, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { height: 13, width: 13, borderRadius: 3, backgroundColor: '#0066FF' }, disabled: { opacity: 0.4 },
  disclaimer: { textAlign: 'center', color: '#858993', fontSize: 10, lineHeight: 15, paddingTop: 10, paddingBottom: 2 },
  errorBox: { padding: 10, backgroundColor: '#FFF3F4', borderRadius: 9, marginHorizontal: 17, marginTop: 6 }, errorText: { color: '#AE4454', fontSize: 11, lineHeight: 17 },
  restart: { minHeight: 44, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginHorizontal: 17 }, restartText: { color: '#0052D6', fontSize: 12, fontWeight: '500' },
  modalBackdrop: { backgroundColor: 'rgba(15,23,42,0.28)' },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fff', boxShadow: '8px 0 32px rgba(15,23,42,0.12)' },
  drawerContent: { flex: 1, paddingHorizontal: 18 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20, gap: 8 }, drawerTitle: { fontSize: 18, color: INK, fontWeight: '600', letterSpacing: -0.5, flex: 1 }, closeGlyph: { fontSize: 24, color: MUTED },
  newChatButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 49, borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#F3F1F8' }, newChatText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  historySearch: { paddingHorizontal: 13, paddingVertical: 13, minHeight: 46, marginTop: 13, borderWidth: 1, borderColor: '#E8E9EE', backgroundColor: '#fff', borderRadius: 11, color: INK, fontSize: 12 },
  historyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 }, refreshButton: { padding: 12 }, refreshText: { color: '#64748B', fontSize: 12 }, historyList: { gap: 5, paddingTop: 5, paddingBottom: 20 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 11 }, activeHistoryItem: { backgroundColor: '#E9EDF7' }, historyTitle: { color: '#475569', fontSize: 14, lineHeight: 21 }, historyKind: { color: '#9296A1', fontSize: 11, marginTop: 5 }, emptyHistory: { color: MUTED, fontSize: 12, lineHeight: 20, paddingVertical: 25 }, historyLoading: { marginTop: 30 },
});
