import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassIcon, GlassPressable, type GlassIconName } from '@/components/ui/GlassIcon';
import { Fonts } from '@/constants/theme';
import { makeStyles, useInsightPalette, usePalette } from '@/hooks/use-theme';
import { streamAiMessage, streamDemoAiChat } from '@/lib/api';
import { createAiRequestGate, type AiKind } from '@/lib/aiChat';
import { asAiOrigin, conversationMessages, createConversation, deleteConversation as removeConversation, listConversations, turnContextFor, type AiOrigin } from '@/lib/aiApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { listHoldings } from '@/lib/portfolioHoldings';
import { useAuth } from '@/store/auth';
import { AiBacktestCard } from '@/components/ai/AiBacktestCard';
import { AiNextSteps } from '@/components/ai/AiNextSteps';
import { AiResearchRunCard } from '@/components/ai/AiResearchRunCard';
import { mergeResearchRunRefs } from '@/lib/aiResearchRun';
import { AiAnalysisCard, AiMarketListCard, AiStrategyDraftCard, AiTickerCard } from '@/components/ai/AiBlockCards';
import { AiChartCard } from '@/components/ai/AiChartCard';
import { AiResponse } from '@/components/ai/AiResponse';
import { parseAiBlocks, type AiParsedBlocks } from '@/lib/aiBlocks';
import { MovingMist } from '@/components/ai/MovingMist';
import { AiTrace } from '@/components/ai/AiTrace';
import { applyStepEvent, settleSteps, stepsFromToolCalls, type ToolStep } from '@/lib/aiTrace';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'stopped' | 'error';
  blocks?: AiParsedBlocks;
  steps?: ToolStep[];
};

const emptyBlocks = (): AiParsedBlocks => ({ charts: [], tickers: [], marketLists: [], analyses: [], drafts: [], backtests: [], researchRuns: [], actions: [] });

function mergeBlock(previous: AiParsedBlocks | undefined, raw: unknown): AiParsedBlocks {
  const next = parseAiBlocks([raw]);
  const base = previous ?? emptyBlocks();
  return {
    charts: [...base.charts, ...next.charts],
    tickers: [...base.tickers, ...next.tickers],
    marketLists: [...base.marketLists, ...next.marketLists],
    analyses: [...base.analyses, ...next.analyses],
    drafts: [...base.drafts, ...next.drafts],
    backtests: [...base.backtests, ...next.backtests],
    researchRuns: mergeResearchRunRefs(base.researchRuns, next.researchRuns),
    actions: next.actions.length ? next.actions : base.actions,
  };
}
type Conversation = { id: string; title: string; kind: AiKind; updatedAt: string };
const ALL_MODES: { kind: AiKind; label: string; hint: string; icon: GlassIconName }[] = [
  { kind: 'chat', label: 'Chat', hint: 'Ask anything about markets', icon: 'community' },
  { kind: 'analysis', label: 'Market', hint: 'Analyze one crypto pair', icon: 'chart' },
  { kind: 'portfolio', label: 'Portfolio', hint: DEMO_MODE ? 'Review your paper portfolio' : 'Analyse the holdings you enter', icon: 'wallet' },
];
const MODES = ALL_MODES;
const STARTERS = [
  { title: 'Check Bitcoin right now', prompt: 'What is Bitcoin trading at right now? Show the latest available price and daily change.', icon: 'chart' as const },
  { title: 'Compare two markets', prompt: 'Compare the latest Bitcoin and Ethereum prices and daily changes. What should I watch?', icon: 'analytics' as const },
  { title: 'Backtest an EMA cross', prompt: 'Draft a long-only EMA 10/30 crossover strategy on BTCUSDT 1h with a 5% stop, then backtest it on recent history and summarise the engine results.', icon: 'analytics' as const },
];
// The assistant reads the user's holdings table itself (get_my_holdings), so prompts just ask.
const PORTFOLIO_REVIEW = 'Analyse my portfolio: overall profit or loss, allocation and concentration, winners and losers, how long I have held each position, and the main risks.';
const PORTFOLIO_STARTERS = [
  { title: 'Review my portfolio', prompt: PORTFOLIO_REVIEW },
  { title: 'Where am I concentrated?', prompt: 'How concentrated is my portfolio? Which positions dominate it and what does that mean for my risk?' },
  { title: 'Which positions are losing?', prompt: 'Which of my holdings are in a loss, by how much, and how long have I held them?' },
];
let messageSeq = 0;
/** Client-side id for a message until the server's saved copy arrives. */
const localMessageId = (role: 'user' | 'assistant') => `${role}-${Date.now()}-${++messageSeq}`;

function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function AiScreen() {
  const styles = useStyles();
  const { textMuted: MUTED } = useInsightPalette();
  const Palette = usePalette();
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
  const { analyze, from } = useLocalSearchParams<{ analyze?: string; from?: string }>();
  /** The screen that opened the assistant; sent with turns until the user starts another chat. */
  const origin = useRef<AiOrigin | undefined>(undefined);
  useEffect(() => {
    const next = asAiOrigin(from);
    if (!next) return;
    origin.current = next;
    router.setParams({ from: undefined });
  }, [from]);

  // The user's real holdings (Portfolio mode). The demo preview keeps its sample paper portfolio.
  const holdingsQuery = useQuery({
    queryKey: ['portfolio-holdings', userId],
    queryFn: ({ signal }) => listHoldings(signal),
    enabled: kind === 'portfolio' && !DEMO_MODE,
  });
  const holdingCount = holdingsQuery.data?.holdings.length ?? 0;
  const refetchHoldings = holdingsQuery.refetch;
  useFocusEffect(useCallback(() => {
    if (kind === 'portfolio' && !DEMO_MODE) void refetchHoldings();
  }, [kind, refetchHoldings]));

  // Welcome-state backdrop: fades out once the conversation starts.
  const showMist = messages.length === 0 && !loadingConversation;
  const [mistOpacity] = useState(() => new Animated.Value(showMist ? 1 : 0));
  useEffect(() => {
    Animated.timing(mistOpacity, {
      toValue: showMist ? 1 : 0, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [showMist, mistOpacity]);

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
    queryFn: ({ signal }) => listConversations(signal),
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
    origin.current = undefined;
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
      await removeConversation(id);
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
      const loaded = await conversationMessages(conversation.id, request.signal);
      if (!gate.isCurrent(request)) return;
      setConversationId(conversation.id);
      setMessages(loaded);
    } catch (err) {
      if (gate.isCurrent(request)) setError(err instanceof Error ? err.message : 'Could not open this conversation.');
    } finally {
      if (gate.isCurrent(request)) setLoadingConversation(false);
      gate.finish(request);
    }
  }

  /** `fresh` sends as the first message of a new conversation in that mode (state from this render is ignored). */
  async function send(text: string, fresh?: { kind: AiKind }) {
    const trimmed = text.trim();
    const turnKind = fresh?.kind ?? kind;
    const currentId = fresh ? undefined : conversationId;
    if (!trimmed || trimmed.length > 4000 || (!fresh && (loadingConversation || needsNewChat)) || (turnKind === 'analysis' && !symbol.trim())) return;
    const request = gate.begin();
    if (!request) return;
    const assistantId = localMessageId('assistant');
    activeAssistant.current = assistantId;
    setMessages((previous) => [...(fresh ? [] : previous),
      { id: localMessageId('user'), role: 'user', content: trimmed },
      { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
    ]);
    if (fresh || !messages.length) setTitle(trimmed);
    setInput('');
    setError(undefined);
    setStreaming(true);
    nearBottom.current = true;
    try {
      const append = (text: string) => setMessages((previous) => previous.map((message) => message.id === assistantId
        ? { ...message, content: message.content + text } : message));
      if (DEMO_MODE) {
        await streamDemoAiChat({ conversationId: currentId, message: trimmed, kind: turnKind, ...(turnKind === 'analysis' ? { symbol: symbol.trim().toUpperCase(), exchange: 'BINANCE' } : {}) }, (event) => {
          if (!gate.isCurrent(request)) return;
          if (event.type === 'meta' && event.conversationId) setConversationId(event.conversationId);
          if (event.type === 'token' && event.content) append(event.content);
        }, request.signal);
      } else {
        const id = currentId ?? (await createConversation(trimmed)).id;
        if (!gate.isCurrent(request)) return;
        setConversationId(id);
        await streamAiMessage(id, trimmed, (event) => {
          if (!gate.isCurrent(request)) return;
          if (event.type === 'delta' && event.text) append(event.text);
          // Tool calls show as trace lines while they run.
          if (event.type === 'status' || event.type === 'tool_result') {
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? { ...message, steps: applyStepEvent(message.steps ?? [], event) } : message));
          }
          // Structured cards arrive as soon as tools run, before the answer text finishes.
          if (event.type === 'block') {
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? { ...message, blocks: mergeBlock(message.blocks, event.block) } : message));
          }
          // The saved reply is authoritative (it also covers replies that arrived without deltas).
          if (event.type === 'assistant_message' && typeof event.message?.content === 'string') {
            const content: string = event.message.content;
            const blocks = parseAiBlocks(event.message.metadata?.blocks);
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? { ...message, content, blocks, steps: message.steps?.length ? settleSteps(message.steps) : stepsFromToolCalls(event.message.metadata?.toolCalls, assistantId) }
              : message));
          }
        }, request.signal, turnContextFor(turnKind, symbol, origin.current));
      }
      if (gate.isCurrent(request)) {
        setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: undefined, steps: settleSteps(message.steps) } : message));
      }
    } catch (err) {
      if (gate.isCurrent(request)) {
        setError(err instanceof Error ? err.message : 'Could not get a response. Please start a new chat.');
        setNeedsNewChat(true);
        setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: 'error', steps: settleSteps(message.steps, 'error') } : message));
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

  // "Analyse with AI" from the holdings table: start a fresh portfolio chat and ask for a review.
  useEffect(() => {
    if (analyze !== 'portfolio') return;
    router.setParams({ analyze: undefined });
    const timer = setTimeout(() => {
      reset('portfolio', symbol || 'BTCUSDT');
      origin.current = 'portfolio_holdings';
      void send(PORTFOLIO_REVIEW, { kind: 'portfolio' });
    }, 0);
    return () => clearTimeout(timer);
    // Runs once per hand-off; reset/send/symbol are read from that render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyze]);

  function stopResponse() {
    const assistantId = activeAssistant.current;
    gate.reset();
    setStreaming(false);
    setNeedsNewChat(true);
    setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, status: 'stopped', steps: settleSteps(message.steps, 'error') } : message));
    activeAssistant.current = undefined;
  }

  const history = (historyQuery.data?.conversations ?? []).filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()));
  const disabled = loadingConversation || needsNewChat || (kind === 'analysis' && !symbol.trim());

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safe}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: mistOpacity }]}>
        <MovingMist active={showMist} />
      </Animated.View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <View style={styles.headerStart}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" hitSlop={4} style={({ pressed }) => [styles.newChatIcon, pressed && styles.pressed]}
              onPress={() => router.navigate('/(tabs)/markets')}>
              <GlassIcon name="home" size={36} tone="purple" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Open conversation history" hitSlop={4} style={({ pressed }) => [styles.newChatIcon, pressed && styles.pressed]}
              onPress={showDrawer}>
              <GlassIcon name="history" size={36} tone="purple" />
            </Pressable>
          </View>
          <View style={styles.headerPill}>
            {messages.length > 0 || loadingConversation
              ? <Text style={styles.headerPillText} numberOfLines={1}>{title}</Text>
              : <Text style={styles.headerPillText} numberOfLines={1}>AI Insight · <Text style={styles.headerPillMuted}>For learning</Text></Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Start a new chat" hitSlop={4} style={({ pressed }) => [styles.newChatIcon, pressed && styles.pressed]} onPress={newChat}>
            <GlassIcon name="add" size={36} tone="purple" />
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
                <Image source={require('@/assets/images/home-ai.png')} style={styles.welcomeArt} contentFit="contain" accessibilityLabel="AI Insight" />
                <Text style={styles.welcomeTitle} accessibilityRole="header">
                  {kind === 'portfolio' ? 'Know your portfolio' : kind === 'analysis' ? 'Explore a pair' : `${greeting()}${firstName ? `, ${firstName}` : ''}`}
                </Text>
                {kind !== 'chat' && <Text style={styles.welcomeSubtitle}>{kind === 'portfolio'
                  ? (DEMO_MODE ? 'Understand your allocation and risk.' : holdingCount ? 'AI reviews your holdings at today\'s prices.' : 'Add what you hold, how much and when you bought it. AI will review it for you.')
                  : 'Choose a symbol above to get started.'}</Text>}
                {kind === 'chat' && <View style={styles.starterChips}>{STARTERS.map((starter) => (
                  <Pressable key={starter.title} accessibilityRole="button" style={({ pressed }) => [styles.starterChip, pressed && styles.pressed]} onPress={() => send(starter.prompt)}>
                    <Text style={styles.starterTitle}>{starter.title}</Text>
                  </Pressable>
                ))}</View>}
                {kind === 'portfolio' && DEMO_MODE && <View style={styles.starterChips}><Pressable accessibilityRole="button" style={({ pressed }) => [styles.starterChip, pressed && styles.pressed]}
                  onPress={() => send('Analyze my paper-trading portfolio: allocation, risk, and educational next steps.')}>
                  <Text style={styles.starterTitle}>Review my paper portfolio</Text>
                </Pressable></View>}
                {kind === 'portfolio' && !DEMO_MODE && <>
                  <Pressable accessibilityRole="button" accessibilityLabel={holdingCount ? `Edit holdings, ${holdingCount} rows` : 'Add your holdings'}
                    onPress={() => router.push('/portfolio/holdings' as Href)} style={({ pressed }) => [styles.holdingsCard, pressed && styles.pressed]}>
                    <GlassIcon name="wallet" size={26} />
                    <View style={styles.flex}>
                      <Text style={styles.holdingsTitle}>{holdingsQuery.isPending ? 'Loading holdings…' : holdingCount ? `${holdingCount} holding${holdingCount === 1 ? '' : 's'} in your table` : 'Add your holdings'}</Text>
                      <Text style={styles.holdingsHint}>{holdingsQuery.isError ? 'Could not load your holdings. Tap to open the table.' : holdingCount ? 'Tap to edit the table' : 'Asset, quantity and buy date: type or paste from Excel'}</Text>
                    </View>
                    <Text style={styles.holdingsAction}>{holdingCount ? 'Edit' : 'Add'}</Text>
                  </Pressable>
                  {holdingCount > 0 && <View style={styles.starterChips}>{PORTFOLIO_STARTERS.map((starter) => (
                    <Pressable key={starter.title} accessibilityRole="button" style={({ pressed }) => [styles.starterChip, pressed && styles.pressed]} onPress={() => send(starter.prompt)}>
                      <Text style={styles.starterTitle}>{starter.title}</Text>
                    </Pressable>
                  ))}</View>}
                </>}
              </View>
            )}
            renderItem={({ item }) => item.role === 'user' ? (
              <View style={styles.userMessage}><Text selectable style={styles.messageText}>{item.content}</Text></View>
            ) : (
              <View style={styles.assistantMessage} accessibilityLabel="AI Insight response">
                <AiTrace steps={item.steps}
                  thinking={item.status === 'streaming' && !item.content && !item.steps?.some((step) => step.status === 'running')} />
                {!!item.content && <AiResponse content={item.content} />}
                {item.blocks?.tickers.map((t, i) => <AiTickerCard key={`t-${t.symbol}-${i}`} ticker={t} />)}
                {item.blocks?.marketLists.map((list, i) => <AiMarketListCard key={`ml-${i}`} list={list} />)}
                {item.blocks?.analyses.map((a, i) => <AiAnalysisCard key={`a-${a.symbol}-${i}`} analysis={a} />)}
                {item.blocks?.charts.map((chart, index) => <AiChartCard key={`${chart.symbol}-${chart.timeframe}-${index}`} chart={chart} />)}
                {item.blocks?.drafts.map((d) => <AiStrategyDraftCard key={d.draftId} draft={d} />)}
                {item.blocks?.backtests.map((b, i) => <AiBacktestCard key={`bt-${b.market.symbol}-${i}`} result={b} />)}
                {item.blocks?.researchRuns.map(run => <AiResearchRunCard key={`${run.kind}-${run.id}`} run={run} />)}
                {!!item.blocks?.actions.length && item.status !== 'streaming' && <AiNextSteps actions={item.blocks.actions} onAsk={(prompt) => void send(prompt)}
                  canAsk={!streaming && !needsNewChat && item.id === messages.at(-1)?.id} />}
                {item.status === 'streaming' && !!item.content && <ActivityIndicator size="small" color={MUTED} style={styles.streamingDot} />}
                {!item.content && !item.blocks?.charts.length && !item.blocks?.backtests.length && !item.blocks?.researchRuns.length && item.status !== 'streaming' && <Text style={styles.muted}>{item.status === 'stopped' ? 'Response stopped.' : 'No response received.'}</Text>}
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
                  <GlassIcon name={mode.icon} size={22} />
                  <View style={styles.flex}><Text style={styles.modeOptionLabel}>{mode.label}</Text><Text style={styles.modeOptionHint}>{mode.hint}</Text></View>
                  {kind === mode.kind && <Text style={styles.modeCheck}>✓</Text>}
                </Pressable>
              ))}
              {kind === 'portfolio' && !DEMO_MODE && <>
                <View style={styles.menuDivider} />
                <Pressable accessibilityRole="menuitem" style={({ pressed }) => [styles.modeOption, pressed && styles.modeOptionPressed]}
                  onPress={() => { setModeMenuOpen(false); router.push('/portfolio/holdings' as Href); }}>
                  <GlassIcon name="analytics" size={22} />
                  <View style={styles.flex}><Text style={styles.modeOptionLabel}>Edit holdings</Text><Text style={styles.modeOptionHint}>Update the table the AI reviews</Text></View>
                </Pressable>
              </>}
            </View>}
            {kind !== 'chat' && <View style={styles.modeTagRow}>
              <View style={styles.modeTag}>
                <Text style={styles.modeTagText}>{MODES.find((mode) => mode.kind === kind)?.label} mode</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Back to Chat mode" hitSlop={10}
                  onPress={() => { setModeMenuOpen(false); reset('chat', symbol || 'BTCUSDT'); }} style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={styles.modeTagClose}>×</Text>
                </Pressable>
              </View>
            </View>}
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: modeMenuOpen }}
                accessibilityLabel={`Mode: ${MODES.find((mode) => mode.kind === kind)?.label}. ${modeMenuOpen ? 'Close menu' : 'Change mode or open tools'}`}
                onPress={() => { Keyboard.dismiss(); setModeMenuOpen((open) => !open); }}
                style={({ pressed }) => [styles.roundButton, styles.plusButton, modeMenuOpen && styles.plusButtonOpen, pressed && styles.pressed]}>
                <View style={[styles.plus, modeMenuOpen && styles.plusOpen]}>
                  <View style={styles.plusBarH} /><View style={styles.plusBarV} />
                </View>
              </Pressable>
              <TextInput accessibilityLabel="Message AI Insight" style={styles.input} value={input} onChangeText={setInput}
                editable={!disabled} multiline maxLength={4000} textAlignVertical="center" placeholderTextColor={MUTED}
                onFocus={() => setModeMenuOpen(false)}
                placeholder={kind === 'portfolio' ? (DEMO_MODE ? 'Ask about your paper portfolio' : 'Ask about your holdings') : kind === 'analysis' ? `Ask about ${symbol || 'an instrument'}` : 'Type a message'} />
              <Pressable accessibilityRole="button" accessibilityLabel={streaming ? 'Stop response' : 'Send message'}
                disabled={!streaming && (disabled || !input.trim())} onPress={streaming ? stopResponse : () => send(input)}
                style={({ pressed }) => [styles.roundButton, styles.sendButton, !streaming && (disabled || !input.trim()) && styles.sendDisabled, pressed && styles.pressed]}>
                {streaming
                  ? <View style={styles.stopGlyph} />
                  : <View style={styles.arrow}>
                      <View style={[styles.arrowHead, (disabled || !input.trim()) && styles.arrowMuted]} />
                      <View style={[styles.arrowStem, (disabled || !input.trim()) && styles.arrowStemMuted]} />
                    </View>}
              </Pressable>
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
                    {deleting ? <ActivityIndicator size="small" color={Palette.onAccent} /> : <Text style={styles.deleteText}>Delete</Text>}
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

// Warm, monochrome chat palette.
const useStyles = makeStyles((Palette, InsightPalette, scheme) => {
  const dark = scheme === 'dark';
  const { text: INK, body: BODY, textMuted: MUTED, bg: PAGE, soft: SOFT, border: LINE, card: CARD, onSolid: ON_SOLID } = InsightPalette;
  return {
    flex: { flex: 1 },
    pressed: { opacity: 0.6 },
    safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: CARD },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    headerStart: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: SOFT },
    newChatIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerPill: { flexShrink: 1, maxWidth: '62%', paddingHorizontal: 12, height: 32, borderRadius: 8, backgroundColor: SOFT, justifyContent: 'center' },
    headerPillText: { color: INK, fontSize: 13, fontWeight: '500' },
    headerPillMuted: { color: MUTED, fontWeight: '400' },
    panel: { flex: 1 },
    messages: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 22 },
    emptyList: { flexGrow: 1, justifyContent: 'center' },
    welcome: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12 },
    welcomeArt: { width: 148, height: 148, marginBottom: 4 },
    welcomeTitle: { fontFamily: Fonts?.serif, fontSize: 26, lineHeight: 34, color: INK, textAlign: 'center', letterSpacing: -0.3 },
    welcomeSubtitle: { fontSize: 14, lineHeight: 21, color: MUTED, marginTop: 8, maxWidth: 270, textAlign: 'center' },
    starterChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 26, maxWidth: 340 },
    starterChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: LINE, backgroundColor: CARD },
    starterTitle: { color: BODY, fontSize: 13, fontWeight: '500' },
    holdingsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, width: '100%', maxWidth: 340, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: LINE, backgroundColor: CARD },
    holdingsTitle: { color: INK, fontSize: 14, fontWeight: '600' },
    holdingsHint: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 2 },
    holdingsAction: { color: INK, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
    promptLabel: { fontSize: 12, color: MUTED, fontWeight: '500' },
    userMessage: { alignSelf: 'flex-end', maxWidth: '82%', borderRadius: 14, backgroundColor: dark ? Palette.purpleMuted : '#EFE8FF', paddingHorizontal: 14, paddingVertical: 10 },
    messageText: { color: INK, fontSize: 14, lineHeight: 21 },
    assistantMessage: { gap: 6, paddingRight: 8 },
    streamingDot: { alignSelf: 'flex-start' },
    responseStatus: { fontSize: 11, color: MUTED, fontStyle: 'italic', marginTop: 3 },
    loading: { paddingVertical: 50, alignItems: 'center', gap: 15 }, muted: { color: MUTED, fontSize: 13 },
    instrumentSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }, instrumentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: LINE, borderRadius: 12, backgroundColor: CARD, paddingLeft: 12, paddingRight: 5, paddingVertical: 4 },
    exchange: { color: MUTED, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 }, symbolInput: { flex: 1, minWidth: 50, fontSize: 13, color: INK, paddingVertical: 10, paddingHorizontal: 6, minHeight: 40 },
    analyzeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, backgroundColor: INK, borderRadius: 8 }, analyzeText: { color: ON_SOLID, fontSize: 12, fontWeight: '600' },
    instrumentHint: { fontSize: 11, lineHeight: 16, color: MUTED, paddingTop: 7 },
    composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
    // Pill composer: round "+" (modes and tools) · message · round send/stop. Buttons stay at the bottom as the message grows.
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6, borderRadius: 30, backgroundColor: dark ? '#2A1820' : '#FFF2F6', borderWidth: 1, borderColor: dark ? '#4A2A38' : '#F1CAD8', boxShadow: '0 2px 10px rgba(180,72,112,0.08)' },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    plusButton: { backgroundColor: dark ? '#3A2230' : '#F8DFE8' },
    plusButtonOpen: { backgroundColor: dark ? '#4A2A3A' : '#F2CEDC' },
    plus: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
    plusOpen: { transform: [{ rotate: '45deg' }] },
    plusBarH: { position: 'absolute', width: 18, height: 2, borderRadius: 1, backgroundColor: INK },
    plusBarV: { position: 'absolute', width: 2, height: 18, borderRadius: 1, backgroundColor: INK },
    input: { flex: 1, color: INK, fontSize: 16, lineHeight: 22, minHeight: 44, maxHeight: 120, paddingHorizontal: 6, paddingTop: 11, paddingBottom: 11 },
    sendButton: { backgroundColor: INK },
    sendDisabled: { backgroundColor: dark ? '#33202A' : '#F4DDE5' },
    arrow: { width: 18, height: 18, alignItems: 'center' },
    arrowHead: { position: 'absolute', top: 2, width: 10, height: 10, borderTopWidth: 2.2, borderLeftWidth: 2.2, borderColor: ON_SOLID, transform: [{ rotate: '45deg' }] },
    arrowStem: { position: 'absolute', top: 2, bottom: 1, width: 2.2, borderRadius: 1.1, backgroundColor: ON_SOLID },
    arrowMuted: { borderColor: MUTED },
    arrowStemMuted: { backgroundColor: MUTED },
    stopGlyph: { height: 12, width: 12, borderRadius: 3, backgroundColor: ON_SOLID },
    disabled: { opacity: 0.4 },
    modeTagRow: { flexDirection: 'row', paddingHorizontal: 6, paddingBottom: 6 },
    modeTag: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 8, height: 26, borderRadius: 13, backgroundColor: dark ? Palette.purpleMuted : '#EFE8FF' },
    modeTagText: { color: dark ? Palette.purple : '#4C3DB8', fontSize: 12, fontWeight: '600' },
    modeTagClose: { color: dark ? Palette.purple : '#4C3DB8', fontSize: 16, lineHeight: 18 },
    modeMenu: { position: 'absolute', left: 12, bottom: '100%', width: 268, padding: 6, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: LINE, boxShadow: '0 8px 24px rgba(31,31,30,0.10)', zIndex: 10 },
    modeOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, minHeight: 44 },
    modeOptionPressed: { backgroundColor: PAGE },
    modeOptionLabel: { color: INK, fontSize: 14, fontWeight: '500' },
    modeOptionHint: { color: MUTED, fontSize: 12, marginTop: 2 },
    modeCheck: { color: INK, fontSize: 14, fontWeight: '600' },
    menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: LINE, marginVertical: 4, marginHorizontal: 8 },
    disclaimer: { textAlign: 'center', color: MUTED, fontSize: 10, lineHeight: 15, paddingTop: 8, paddingBottom: 2 },
    errorBox: { padding: 10, backgroundColor: Palette.redMuted, borderRadius: 9, marginHorizontal: 16, marginTop: 6 }, errorText: { color: dark ? InsightPalette.red : '#B91C1C', fontSize: 12, lineHeight: 17 },
    restart: { minHeight: 44, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginHorizontal: 16 }, restartText: { color: INK, fontSize: 13, fontWeight: '500', textDecorationLine: 'underline' },
    modalBackdrop: { backgroundColor: Palette.overlay },
    drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: PAGE, boxShadow: '8px 0 32px rgba(31,31,30,0.12)' },
    drawerContent: { flex: 1, paddingHorizontal: 18 },
    drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20, gap: 8 }, drawerTitle: { fontFamily: Fonts?.serif, fontSize: 20, color: INK, flex: 1 }, closeGlyph: { fontSize: 22, color: INK },
    newChatButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, borderRadius: 10, paddingHorizontal: 13, backgroundColor: SOFT }, newChatText: { color: INK, fontSize: 13, fontWeight: '500' },
    historySearch: { paddingHorizontal: 13, paddingVertical: 12, minHeight: 44, marginTop: 12, borderWidth: 1, borderColor: LINE, backgroundColor: CARD, borderRadius: 10, color: INK, fontSize: 13 },
    historyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 }, refreshButton: { padding: 12 }, refreshText: { color: MUTED, fontSize: 12 }, historyList: { gap: 4, paddingTop: 5, paddingBottom: 20 },
    historyItem: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 10 }, activeHistoryItem: { backgroundColor: SOFT }, historyTitle: { color: BODY, fontSize: 14, lineHeight: 20 }, historyKind: { color: MUTED, fontSize: 11, marginTop: 4 }, confirmItem: { backgroundColor: CARD, borderWidth: 1, borderColor: LINE, gap: 8 }, confirmTitle: { color: INK, fontSize: 14, fontWeight: '600' },
    confirmButton: { minHeight: 36, minWidth: 64, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, confirmCancel: { color: BODY, fontSize: 13, fontWeight: '500' },
    deleteButton: { backgroundColor: '#DC2626' }, deleteText: { color: Palette.onAccent, fontSize: 13, fontWeight: '600' },
    emptyHistory: { color: MUTED, fontSize: 13, lineHeight: 20, paddingVertical: 25 }, historyLoading: { marginTop: 30 },
  };
});
