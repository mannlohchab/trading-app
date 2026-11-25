import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput as NativeTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/AppText';
import { GlassIcon } from '@/components/ui/GlassIcon';
import { Fonts } from '@/constants/theme';
import { makeStyles, useColorScheme, useInsightPalette } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import {
  cellErrorsFromServer, emptyRow, isBlankRow, listHoldings, MAX_HOLDING_ROWS, parsePastedTable, rowsFromTable,
  rowsToHoldings, saveHoldings, type CellErrors, type HoldingField, type HoldingRow,
} from '@/lib/portfolioHoldings';
import { useAuth } from '@/store/auth';

type CellInput = ComponentRef<typeof NativeTextInput>;

const COLUMNS: { field: HoldingField; label: string; placeholder: string; width: number; numeric?: boolean }[] = [
  { field: 'asset', label: 'Asset', placeholder: 'BTC', width: 112 },
  { field: 'quantity', label: 'Quantity', placeholder: '0.5', width: 96, numeric: true },
  { field: 'boughtOn', label: 'Bought on', placeholder: 'DD/MM/YYYY', width: 116 },
  { field: 'buyPrice', label: 'Buy price', placeholder: 'Optional', width: 104, numeric: true },
];
const STARTER_ROWS = 3;

export default function HoldingsScreen() {
  const styles = useStyles();
  const { text: INK, textMuted: MUTED } = useInsightPalette();
  const placeholderColor = useColorScheme() === 'dark' ? MUTED : '#B5B5B0';
  const userId = useAuth((state) => state.user?.id);
  const queryClient = useQueryClient();
  const queryKey = ['portfolio-holdings', userId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => listHoldings(signal) });
  // Until the user edits, the grid shows the saved table (or a few empty rows to start).
  const initialRows = useMemo(() => {
    if (!query.data) return null;
    const saved = rowsFromTable(query.data);
    return saved.length ? saved : Array.from({ length: STARTER_ROWS }, emptyRow);
  }, [query.data]);
  const [edited, setEdited] = useState<HoldingRow[] | null>(null);
  const rows = edited ?? initialRows;
  const setRows = (next: HoldingRow[] | ((current: HoldingRow[] | null) => HoldingRow[] | null)) =>
    setEdited((current) => typeof next === 'function' ? next(current ?? initialRows) : next);
  const [errors, setErrors] = useState<CellErrors>({});
  const [formError, setFormError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const cells = useRef(new Map<string, CellInput | null>());

  const filled = rows?.filter((row) => !isBlankRow(row)).length ?? 0;

  function change(key: string, field: HoldingField, value: string) {
    setRows((current) => current?.map((row) => row.key === key ? { ...row, [field]: field === 'asset' ? value.toUpperCase() : value } : row) ?? current);
    setErrors(({ [`${key}.${field}`]: _cleared, ...rest }) => rest);
    setDirty(true);
    setJustSaved(false);
  }

  function addRow(focus = true) {
    if (!rows || rows.length >= MAX_HOLDING_ROWS) return;
    const row = emptyRow();
    setRows([...rows, row]);
    if (focus) setTimeout(() => cells.current.get(`${row.key}.asset`)?.focus(), 50);
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current?.filter((row) => row.key !== key) ?? [];
      return next.length ? next : [emptyRow()];
    });
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([cell]) => !cell.startsWith(`${key}.`))));
    setDirty(true);
    setJustSaved(false);
  }

  /** Return key moves across the row, then down to the next row (adding one at the end). */
  function focusNext(rowIndex: number, columnIndex: number) {
    if (!rows) return;
    if (columnIndex < COLUMNS.length - 1) return cells.current.get(`${rows[rowIndex]!.key}.${COLUMNS[columnIndex + 1]!.field}`)?.focus();
    const next = rows[rowIndex + 1];
    if (next) cells.current.get(`${next.key}.asset`)?.focus();
    else addRow();
  }

  function applyPaste(mode: 'replace' | 'append') {
    const pasted = parsePastedTable(pasteText);
    if (!pasted.length || !rows) return;
    const kept = mode === 'append' ? rows.filter((row) => !isBlankRow(row)) : [];
    setRows([...kept, ...pasted].slice(0, MAX_HOLDING_ROWS));
    setErrors({});
    setFormError(undefined);
    setDirty(true);
    setJustSaved(false);
    setPasteText('');
    setPasteOpen(false);
  }

  async function save() {
    if (!rows || saving) return;
    const { holdings, rowKeys, errors: local } = rowsToHoldings(rows);
    setErrors(local);
    if (Object.keys(local).length) { setFormError('Fix the highlighted cells, then save again.'); return; }
    setFormError(undefined);
    setSaving(true);
    try {
      const saved = await saveHoldings(holdings);
      queryClient.setQueryData(queryKey, saved);
      const next = rowsFromTable(saved);
      setRows(next.length ? next : [emptyRow()]);
      setErrors({});
      setDirty(false);
      setJustSaved(true);
    } catch (err) {
      const fromServer = err instanceof ApiError ? cellErrorsFromServer(err.details, rowKeys) : {};
      setErrors(fromServer);
      setFormError(Object.keys(fromServer).length ? 'Fix the highlighted cells, then save again.' : err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const firstError = rows && Object.keys(errors).length ? (() => {
    for (const [index, row] of rows.entries()) for (const column of COLUMNS) {
      const message = errors[`${row.key}.${column.field}`];
      if (message) return `Row ${index + 1} · ${column.label}: ${message}`;
    }
  })() : undefined;
  const pastedCount = pasteOpen ? parsePastedTable(pasteText).length : 0;
  const canAnalyze = !dirty && filled > 0 && (justSaved || !!query.data?.holdings.length);

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ title: 'My holdings' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">What do you hold?</Text>
          <Text style={styles.intro}>
            One row per purchase. Leave the buy price empty if you don&apos;t know it: for coins listed on Binance, AI uses that day&apos;s closing price. Prices are in USDT.
          </Text>

          <View style={styles.toolbar}>
            <Pressable accessibilityRole="button" onPress={() => addRow()} disabled={!rows || rows.length >= MAX_HOLDING_ROWS}
              style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}>
              <Text style={styles.toolText}>+ Add row</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityHint="Paste rows copied from Excel or Google Sheets" onPress={() => setPasteOpen(true)} disabled={!rows}
              style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}>
              <Text style={styles.toolText}>Paste from Excel</Text>
            </Pressable>
            <Text style={styles.count}>{filled}/{MAX_HOLDING_ROWS}</Text>
          </View>

          {query.isPending && <View style={styles.loading}><ActivityIndicator color={MUTED} /></View>}
          {query.isError && !rows && (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Text style={styles.errorText}>Could not load your holdings.</Text>
              <Pressable accessibilityRole="button" onPress={() => { void query.refetch(); }}><Text style={styles.retry}>Retry</Text></Pressable>
            </View>
          )}

          {rows && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.gridScroll}>
              <View style={styles.grid} accessibilityLabel="Holdings table">
                <View style={[styles.gridRow, styles.headerRow]}>
                  <Text style={[styles.indexCell, styles.headerText]}>#</Text>
                  {COLUMNS.map((column) => (
                    <Text key={column.field} style={[styles.headerText, styles.headerCell, { width: column.width }]}>{column.label}</Text>
                  ))}
                  <View style={styles.actionCell} />
                </View>
                {rows.map((row, rowIndex) => (
                  <View key={row.key} style={[styles.gridRow, rowIndex % 2 === 1 && styles.altRow]}>
                    <Text style={styles.indexCell}>{rowIndex + 1}</Text>
                    {COLUMNS.map((column, columnIndex) => {
                      const error = errors[`${row.key}.${column.field}`];
                      return (
                        <TextInput key={column.field}
                          ref={(input) => { cells.current.set(`${row.key}.${column.field}`, input); }}
                          accessibilityLabel={`Row ${rowIndex + 1} ${column.label}`}
                          accessibilityHint={error}
                          value={row[column.field]} placeholder={column.placeholder} placeholderTextColor={placeholderColor}
                          onChangeText={(value) => change(row.key, column.field, value)}
                          keyboardType={column.numeric ? 'decimal-pad' : column.field === 'boughtOn' ? 'numbers-and-punctuation' : 'default'}
                          autoCapitalize={column.field === 'asset' ? 'characters' : 'none'} autoCorrect={false}
                          maxLength={column.field === 'asset' ? 30 : column.field === 'boughtOn' ? 10 : 24}
                          returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => focusNext(rowIndex, columnIndex)}
                          style={[styles.cell, { width: column.width }, column.numeric && styles.numericCell, !!error && styles.errorCell]} />
                      );
                    })}
                    <Pressable accessibilityRole="button" accessibilityLabel={`Delete row ${rowIndex + 1}`} hitSlop={6} onPress={() => removeRow(row.key)}
                      style={({ pressed }) => [styles.actionCell, pressed && styles.pressed]}>
                      <Text style={styles.deleteGlyph}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}

          {(firstError || formError) && (
            <View accessibilityRole="alert" style={styles.errorBox}>
              {!!firstError && <Text style={styles.errorText}>{firstError}</Text>}
              {!!formError && <Text style={styles.errorText}>{formError}</Text>}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {justSaved && !dirty && <Text style={styles.savedText} accessibilityLiveRegion="polite">Saved</Text>}
          {dirty && <Text style={styles.unsavedText}>Unsaved changes</Text>}
          <View style={styles.footerButtons}>
            <Pressable accessibilityRole="button" disabled={!rows || saving || !dirty} onPress={save}
              style={({ pressed }) => [styles.secondaryButton, (!dirty || saving) && styles.disabled, pressed && styles.pressed]}>
              {saving ? <ActivityIndicator size="small" color={INK} /> : <Text style={styles.secondaryText}>Save</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!canAnalyze}
              onPress={() => router.navigate({ pathname: '/(tabs)/ai', params: { analyze: 'portfolio' } })}
              style={({ pressed }) => [styles.primaryButton, !canAnalyze && styles.disabled, pressed && styles.pressed]}>
              <Text style={styles.primaryText}>Analyse with AI</Text>
              <GlassIcon name="analytics" size={18} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={pasteOpen} transparent animationType="fade" onRequestClose={() => setPasteOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <Text style={styles.modalTitle}>Paste from a spreadsheet</Text>
            <Text style={styles.modalHint}>
              Copy the cells in Excel or Google Sheets and paste them here. Columns: Asset, Quantity, Bought on, Buy price, or include your header row in any order.
            </Text>
            <TextInput accessibilityLabel="Pasted rows" value={pasteText} onChangeText={setPasteText} multiline autoFocus
              placeholder={'BTC\t0.5\t10/01/2025\t60000\nETH\t2\t01/03/2026'} placeholderTextColor={placeholderColor}
              autoCapitalize="none" autoCorrect={false} textAlignVertical="top" style={styles.pasteInput} />
            <Text style={styles.modalCount}>{pasteText.trim() ? `${pastedCount} row${pastedCount === 1 ? '' : 's'} found` : ' '}</Text>
            <View style={styles.modalButtons}>
              <Pressable accessibilityRole="button" onPress={() => setPasteOpen(false)} style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!pastedCount} onPress={() => applyPaste('append')}
                style={({ pressed }) => [styles.modalButton, !pastedCount && styles.disabled, pressed && styles.pressed]}>
                <Text style={styles.secondaryText}>Add</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!pastedCount} onPress={() => applyPaste('replace')}
                style={({ pressed }) => [styles.modalButton, styles.modalPrimary, !pastedCount && styles.disabled, pressed && styles.pressed]}>
                <Text style={styles.primaryText}>Replace table</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((Palette, InsightPalette, scheme) => {
  const dark = scheme === 'dark';
  const { text: INK, body: BODY, textMuted: MUTED, bg: PAGE, soft: SOFT, border: LINE, card: CARD, onSolid: ON_SOLID, red: RED } = InsightPalette;
  return {
    flex: { flex: 1 },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.4 },
    safe: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', backgroundColor: PAGE },
    content: { padding: 16, paddingBottom: 28, gap: 12 },
    title: { fontFamily: Fonts?.serif, fontSize: 24, lineHeight: 31, color: INK, letterSpacing: -0.3 },
    intro: { fontSize: 13, lineHeight: 19, color: BODY },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    toolButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: CARD, justifyContent: 'center' },
    toolText: { color: INK, fontSize: 13, fontWeight: '500' },
    count: { marginLeft: 'auto', color: MUTED, fontSize: 12, fontVariant: ['tabular-nums'] },
    loading: { paddingVertical: 40 },
    gridScroll: { marginHorizontal: -16 },
    grid: { marginHorizontal: 16, borderWidth: 1, borderColor: LINE, borderRadius: 10, overflow: 'hidden', backgroundColor: CARD },
    gridRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: LINE },
    headerRow: { backgroundColor: SOFT },
    altRow: { backgroundColor: dark ? Palette.cardHover : '#FBFBFA' },
    headerText: { color: BODY, fontSize: 11, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
    headerCell: { paddingHorizontal: 8, paddingVertical: 9, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: LINE },
    indexCell: { width: 30, textAlign: 'center', textAlignVertical: 'center', paddingVertical: 9, color: MUTED, fontSize: 11, fontVariant: ['tabular-nums'] },
    cell: { minHeight: 44, paddingHorizontal: 8, color: INK, fontSize: 14, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: LINE },
    numericCell: { textAlign: 'right', fontVariant: ['tabular-nums'] },
    errorCell: { backgroundColor: Palette.redMuted, borderWidth: 1.5, borderColor: RED },
    actionCell: { width: 40, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderColor: LINE },
    deleteGlyph: { color: MUTED, fontSize: 20, lineHeight: 22 },
    errorBox: { padding: 10, backgroundColor: Palette.redMuted, borderRadius: 9, gap: 4 },
    errorText: { color: dark ? RED : '#B91C1C', fontSize: 12, lineHeight: 17 },
    retry: { color: INK, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
    footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: LINE, backgroundColor: CARD, gap: 6 },
    savedText: { color: dark ? Palette.green : '#15803D', fontSize: 12, fontWeight: '500' },
    unsavedText: { color: MUTED, fontSize: 12 },
    footerButtons: { flexDirection: 'row', gap: 10 },
    secondaryButton: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: LINE, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
    secondaryText: { color: INK, fontSize: 14, fontWeight: '600' },
    primaryButton: { flex: 1.4, minHeight: 46, borderRadius: 10, backgroundColor: INK, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: ON_SOLID, fontSize: 14, fontWeight: '600' },
    modalBackdrop: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'center', padding: 16 },
    modalCard: { backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 10, maxWidth: 520, width: '100%', alignSelf: 'center' },
    modalTitle: { fontFamily: Fonts?.serif, fontSize: 20, color: INK },
    modalHint: { fontSize: 13, lineHeight: 19, color: BODY },
    pasteInput: { minHeight: 140, maxHeight: 260, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 10, fontSize: 13, color: INK, fontFamily: Fonts?.mono },
    modalCount: { fontSize: 12, color: MUTED },
    modalButtons: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
    modalButton: { minHeight: 42, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1, borderColor: LINE, alignItems: 'center', justifyContent: 'center' },
    modalPrimary: { backgroundColor: INK, borderColor: INK },
  };
});
