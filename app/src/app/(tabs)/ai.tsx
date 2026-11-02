import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassIcon, GlassPressable, type GlassIconName } from '@/components/ui/GlassIcon';
import { Fonts } from '@/constants/theme';
import { api, streamAiChat } from '@/lib/api';
import { createAiRequestGate, type AiKind } from '@/lib/aiChat';
import { useAuth } from '@/store/auth';
import { AiResponse } from '@/components/ai/AiResponse';

type Message = { id: string; role: 'user' | 'assistant'; content: string; status?: 'streaming' | 'stopped' | 'error' };
type Conversation = { id: string; title: string; kind: AiKind; updatedAt: string };
const MODES: { kind: AiKind; label: string; hint: string; icon: GlassIconName }[] = [
  { kind: 'chat', label: 'Chat', hint: 'Ask anything about markets', icon: 'community' },
  { kind: 'analysis', label: 'Market', hint: 'Analyze one crypto or forex pair', icon: 'chart' },
  { kind: 'portfolio', label: 'Portfolio', hint: 'Review your paper portfolio', icon: 'wallet' },
];
const STARTERS = [
  { title: 'Check Bitcoin right now', prompt: 'What is Bitcoin trading at right now? Show the latest available price and daily change.', icon: 'chart' as const },
  { title: 'Compare two markets', prompt: 'Compare the latest Bitcoin and Ethereum prices and daily changes. What should I watch?', icon: 'analytics' as const },
];
// Warm, monochrome chat palette.
const INK = '#1F1F1E';
const BODY = '#3D3D3A';
const MUTED = '#8A8A86';
const PAGE = '#F7F7F5';
const SOFT = '#EDEDEA';
const LINE = '#E6E6E2';
const LOGO = 'https://i.pinimg.com/736x/b7/4a/b3/b74ab3b922824a6ccc26837cb6f4498b.jpg';

function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function AiScreen() {
  const userId = useAuth((state) => state.user?.id);
  const firstName = useAuth((state) => (state.user?.displayName || state.user?.username || '').trim().split(/\s+/)[0]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
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
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
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
    setPendingDelete(undefined);
    setDeleteError(undefined);
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

  function askDelete(id: string) {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDeleteError(undefined);
    setPendingDelete(id);
  }

  async function deleteConversation(id: string) {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await api(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      queryClient.setQueryData<{ conversations: Conversation[] }>(historyKey, (data) =>
        data ? { conversations: data.conversations.filter((item) => item.id !== id) } : data);
      if (id === conversationId) reset(kind, symbol || 'BTCUSDT');
      setPendingDelete(undefined);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this chat. Please try again.');
    } finally {
      setDeleting(false);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    }
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
          <Pressable accessibilityRole="button" accessibilityLabel="Open conversation history" style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            onPress={showDrawer}>
            <View style={styles.menuGlyph}><View style={styles.menuLine} /><View style={[styles.menuLine, { width: 10 }]} /></View>
          </Pressable>
          <View style={styles.headerPill}>
            {messages.length > 0 || loadingConversation
              ? <Text style={styles.headerPillText} numberOfLines={1}>{title}</Text>
              : <Text style={styles.headerPillText} numberOfLines={1}>AI Insight · <Text style={styles.headerPillMuted}>For learning</Text></Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Start a new chat" style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} onPress={newChat}>
            <View style={styles.plusGlyph}><View style={styles.plusH} /><View style={styles.plusV} /></View>
          </Pressable>
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
            ListEmptyComponent={loadingConversation ? <View style={styles.loading}><ActivityIndicator color={MUTED} /><Text style={styles.muted}>Opening conversation…</Text></View> : (
              <View style={styles.welcome}>
                <Image source={{ uri: LOGO }} style={styles.welcomeLogo} contentFit="cover" accessibilityLabel="Gurukul" />
                <Text style={styles.welcomeTitle} accessibilityRole="header">
                  {kind === 'portfolio' ? 'Know your portfolio' : kind === 'analysis' ? 'Explore a pair' : `${greeting()}${firstName ? `, ${firstName}` : ''}`}
                </Text>
                {kind !== 'chat' && <Text style={styles.welcomeSubtitle}>{kind === 'portfolio' ? 'Understand your allocation and risk.' : 'Choose a symbol above to get started.'}</Text>}
                {kind === 'chat' && <View style={styles.starterChips}>{STARTERS.map((starter) => (
                  <Pressable key={starter.title} accessibilityRole="button" style={({ pressed }) => [styles.starterChip, pressed && styles.pressed]} onPress={() => send(starter.prompt)}>
                    <Text style={styles.starterTitle}>{starter.title}</Text>
                  </Pressable>
                ))}</View>}
                {kind === 'portfolio' && <View style={styles.starterChips}><Pressable accessibilityRole="button" style={({ pressed }) => [styles.starterChip, pressed && styles.pressed]}
                  onPress={() => send('Analyze my paper-trading portfolio: allocation, risk, and educational next steps.')}>
                  <Text style={styles.starterTitle}>Review my paper portfolio</Text>
                </Pressable></View>}
              </View>
            )}
            renderItem={({ item }) => item.role === 'user' ? (
              <View style={styles.userMessage}><Text selectable style={styles.messageText}>{item.content}</Text></View>
            ) : (
              <View style={styles.assistantMessage} accessibilityLabel="AI Insight response">
                {!!item.content && <AiResponse content={item.content} />}
                {item.status === 'streaming' && !!item.content && <ActivityIndicator size="small" color={MUTED} style={styles.streamingDot} />}
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
            {modeMenuOpen && <View style={styles.modeMenu} accessibilityRole="menu">
              {MODES.map((mode) => (
                <Pressable key={mode.kind} accessibilityRole="menuitem" accessibilityState={{ selected: kind === mode.kind }}
                  style={({ pressed }) => [styles.modeOption, pressed && styles.modeOptionPressed]}
                  onPress={() => { setModeMenuOpen(false); if (kind !== mode.kind) reset(mode.kind, symbol || 'BTCUSDT'); }}>
                  <View style={styles.flex}><Text style={styles.modeOptionLabel}>{mode.label}</Text><Text style={styles.modeOptionHint}>{mode.hint}</Text></View>
                  {kind === mode.kind && <Text style={styles.modeCheck}>✓</Text>}
                </Pressable>
              ))}
            </View>}
            <View style={styles.composer}>
              <TextInput accessibilityLabel="Message AI Insight" style={styles.input} value={input} onChangeText={setInput}
                editable={!disabled} multiline maxLength={4000} textAlignVertical="top" placeholderTextColor={MUTED}
                onFocus={() => setModeMenuOpen(false)}
                placeholder={kind === 'portfolio' ? 'Ask about your paper portfolio…' : kind === 'analysis' ? `Ask about ${symbol || 'an instrument'}…` : 'How can I help you today?'} />
              <View style={styles.composerToolbar}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Mode: ${MODES.find((mode) => mode.kind === kind)?.label}. Change mode`}
                  accessibilityState={{ expanded: modeMenuOpen }} onPress={() => setModeMenuOpen((open) => !open)}
                  style={({ pressed }) => [styles.modePicker, pressed && styles.pressed]}>
                  <Text style={styles.modePickerText}>{MODES.find((mode) => mode.kind === kind)?.label}</Text>
                  <View style={[styles.chevron, modeMenuOpen && styles.chevronUp]} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={streaming ? 'Stop response' : 'Send message'}
                  disabled={!streaming && (disabled || !input.trim())} onPress={streaming ? stopResponse : () => send(input)}
                  style={({ pressed }) => [styles.sendButton, !streaming && (disabled || !input.trim()) && styles.sendDisabled, pressed && styles.pressed]}>
                  {streaming ? <View style={styles.stopGlyph} /> : <Text style={styles.sendGlyph}>↑</Text>}
                </Pressable>
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
              {historyQuery.isPending && <ActivityIndicator color={MUTED} style={styles.historyLoading} />}
              {historyQuery.isError && <Text accessibilityRole="alert" style={styles.errorText}>Could not load conversations. Tap Refresh to retry.</Text>}
              {!historyQuery.isPending && !historyQuery.isError && !history.length && <Text style={styles.emptyHistory}>{search ? 'No matching conversations.' : 'Your conversations will appear here after your first message.'}</Text>}
              {!!deleteError && <Text accessibilityRole="alert" style={styles.errorText}>{deleteError}</Text>}
              {history.map((conversation) => pendingDelete === conversation.id ? (
                <View key={conversation.id} style={[styles.historyItem, styles.confirmItem]} accessibilityLiveRegion="polite">
                  <View style={styles.flex}><Text style={styles.confirmTitle}>Delete this chat?</Text><Text style={styles.historyKind} numberOfLines={1}>{conversation.title}</Text></View>
                  <Pressable accessibilityRole="button" disabled={deleting} onPress={() => setPendingDelete(undefined)} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}>
                    <Text style={styles.confirmCancel}>Cancel</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${conversation.title}`} disabled={deleting} onPress={() => deleteConversation(conversation.id)}
                    style={({ pressed }) => [styles.confirmButton, styles.deleteButton, (pressed || deleting) && styles.pressed]}>
                    {deleting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.deleteText}>Delete</Text>}
                  </Pressable>
                </View>
              ) : <GlassPressable key={conversation.id} accessibilityRole="button" accessibilityHint="Long press to delete"
                accessibilityActions={[{ name: 'delete', label: 'Delete conversation' }]}
                onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'delete') askDelete(conversation.id); }}
                onPress={() => { if (pendingDelete) { setPendingDelete(undefined); return; } void openConversation(conversation); }}
                onLongPress={() => askDelete(conversation.id)} delayLongPress={400}
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
  pressed: { opacity: 0.6 },
  safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: PAGE },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: SOFT },
  menuGlyph: { gap: 5 }, menuLine: { width: 16, height: 1.5, backgroundColor: INK, borderRadius: 1 },
  plusGlyph: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  plusH: { position: 'absolute', width: 14, height: 1.5, backgroundColor: INK, borderRadius: 1 },
  plusV: { position: 'absolute', width: 1.5, height: 14, backgroundColor: INK, borderRadius: 1 },
  headerPill: { flexShrink: 1, maxWidth: '62%', paddingHorizontal: 12, height: 32, borderRadius: 8, backgroundColor: SOFT, justifyContent: 'center' },
  headerPillText: { color: INK, fontSize: 13, fontWeight: '500' },
  headerPillMuted: { color: MUTED, fontWeight: '400' },
  panel: { flex: 1, backgroundColor: PAGE },
  messages: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 22 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  welcome: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12 },
  welcomeLogo: { width: 44, height: 44, borderRadius: 12, marginBottom: 16, backgroundColor: SOFT },
  welcomeTitle: { fontFamily: Fonts?.serif, fontSize: 26, lineHeight: 34, color: INK, textAlign: 'center', letterSpacing: -0.3 },
  welcomeSubtitle: { fontSize: 14, lineHeight: 21, color: MUTED, marginTop: 8, maxWidth: 270, textAlign: 'center' },
  starterChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 26, maxWidth: 340 },
  starterChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: '#FFFFFF' },
  starterTitle: { color: BODY, fontSize: 13, fontWeight: '500' },
  promptLabel: { fontSize: 12, color: MUTED, fontWeight: '500' },
  userMessage: { alignSelf: 'flex-end', maxWidth: '82%', borderRadius: 10, backgroundColor: SOFT, paddingHorizontal: 14, paddingVertical: 10 },
  messageText: { color: INK, fontSize: 14, lineHeight: 21 },
  assistantMessage: { gap: 6, paddingRight: 8 },
  streamingDot: { alignSelf: 'flex-start' },
  responseStatus: { fontSize: 11, color: MUTED, fontStyle: 'italic', marginTop: 3 },
  loading: { paddingVertical: 50, alignItems: 'center', gap: 15 }, muted: { color: MUTED, fontSize: 13 },
  instrumentSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }, instrumentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: LINE, borderRadius: 12, backgroundColor: '#FFFFFF', paddingLeft: 12, paddingRight: 5, paddingVertical: 4 },
  exchange: { color: MUTED, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 }, symbolInput: { flex: 1, minWidth: 50, fontSize: 13, color: INK, paddingVertical: 10, paddingHorizontal: 6, minHeight: 40 },
  analyzeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, backgroundColor: INK, borderRadius: 8 }, analyzeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  instrumentHint: { fontSize: 11, lineHeight: 16, color: MUTED, paddingTop: 7 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, backgroundColor: PAGE },
  composer: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: LINE, boxShadow: '0 1px 2px rgba(31,31,30,0.04)' },
  input: { color: INK, fontSize: 15, lineHeight: 22, minHeight: 44, maxHeight: 120, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 8 },
  composerToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  modePicker: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 36, paddingHorizontal: 10, borderRadius: 8 },
  modePickerText: { color: BODY, fontSize: 13, fontWeight: '500' },
  chevron: { width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: BODY, transform: [{ rotate: '45deg' }], marginTop: -3 },
  chevronUp: { transform: [{ rotate: '-135deg' }], marginTop: 3 },
  modeMenu: { position: 'absolute', right: 12, bottom: '100%', width: 248, padding: 6, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: LINE, boxShadow: '0 8px 24px rgba(31,31,30,0.10)', zIndex: 10 },
  modeOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9, minHeight: 44 },
  modeOptionPressed: { backgroundColor: PAGE },
  modeOptionLabel: { color: INK, fontSize: 14, fontWeight: '500' },
  modeOptionHint: { color: MUTED, fontSize: 12, marginTop: 2 },
  modeCheck: { color: INK, fontSize: 14, fontWeight: '600' },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#D4D4D0' },
  sendGlyph: { color: '#FFFFFF', fontSize: 18, lineHeight: 20, fontWeight: '600' },
  stopGlyph: { height: 11, width: 11, borderRadius: 2, backgroundColor: '#FFFFFF' }, disabled: { opacity: 0.4 },
  disclaimer: { textAlign: 'center', color: MUTED, fontSize: 10, lineHeight: 15, paddingTop: 8, paddingBottom: 2 },
  errorBox: { padding: 10, backgroundColor: '#FBEFEF', borderRadius: 9, marginHorizontal: 16, marginTop: 6 }, errorText: { color: '#A23E3E', fontSize: 12, lineHeight: 17 },
  restart: { minHeight: 44, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginHorizontal: 16 }, restartText: { color: INK, fontSize: 13, fontWeight: '500', textDecorationLine: 'underline' },
  modalBackdrop: { backgroundColor: 'rgba(31,31,30,0.28)' },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: PAGE, boxShadow: '8px 0 32px rgba(31,31,30,0.12)' },
  drawerContent: { flex: 1, paddingHorizontal: 18 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20, gap: 8 }, drawerTitle: { fontFamily: Fonts?.serif, fontSize: 20, color: INK, flex: 1 }, closeGlyph: { fontSize: 22, color: INK },
  newChatButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, borderRadius: 10, paddingHorizontal: 13, backgroundColor: SOFT }, newChatText: { color: INK, fontSize: 13, fontWeight: '500' },
  historySearch: { paddingHorizontal: 13, paddingVertical: 12, minHeight: 44, marginTop: 12, borderWidth: 1, borderColor: LINE, backgroundColor: '#FFFFFF', borderRadius: 10, color: INK, fontSize: 13 },
  historyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 }, refreshButton: { padding: 12 }, refreshText: { color: MUTED, fontSize: 12 }, historyList: { gap: 4, paddingTop: 5, paddingBottom: 20 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 10 }, activeHistoryItem: { backgroundColor: SOFT }, historyTitle: { color: BODY, fontSize: 14, lineHeight: 20 }, historyKind: { color: MUTED, fontSize: 11, marginTop: 4 }, confirmItem: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: LINE, gap: 8 }, confirmTitle: { color: INK, fontSize: 14, fontWeight: '600' },
  confirmButton: { minHeight: 36, minWidth: 64, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, confirmCancel: { color: BODY, fontSize: 13, fontWeight: '500' },
  deleteButton: { backgroundColor: '#DC2626' }, deleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  emptyHistory: { color: MUTED, fontSize: 13, lineHeight: 20, paddingVertical: 25 }, historyLoading: { marginTop: 30 },
});
