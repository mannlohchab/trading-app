import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import { Text, TextInput } from '@/components/ui/AppText';
import { Fonts } from '@/constants/theme';
import { makeStyles, useColorScheme, usePalette } from '@/hooks/use-theme';
import { timezoneOptions } from '@/lib/timezones';

const PURPLE_FILL = '#6F47E9';

type Props = {
  visible: boolean;
  current: string;
  device: string;
  onSelect: (zone: string) => void;
  onClose: () => void;
};

export function TimezonePicker({ visible, current, device, onSelect, onClose }: Props) {
  const styles = useStyles();
  const Palette = usePalette();
  const scheme = useColorScheme();
  const [search, setSearch] = useState('');
  const options = useMemo(() => visible ? timezoneOptions({ search, current, device }) : [], [visible, search, current, device]);
  const close = () => { setSearch(''); onClose(); };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessibilityLabel="Close time zone picker" style={styles.dismiss} onPress={close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Time zone</Text>
          <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Event times and days on the calendar follow this zone.</Text>
        <TextInput accessibilityLabel="Search time zones" value={search} onChangeText={setSearch} autoCorrect={false} autoCapitalize="none"
          placeholder="Search city, region or UTC+5:30" placeholderTextColor={scheme === 'dark' ? Palette.textMuted : '#96909F'} style={styles.search} />
        <FlatList
          data={options}
          keyExtractor={option => option.zone}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No time zone matches “{search.trim()}”.</Text>}
          renderItem={({ item }) => {
            const selected = item.zone === current;
            return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${item.city}, ${item.region}, ${item.offset}${item.zone === device ? ', device time zone' : ''}`}
              onPress={() => { setSearch(''); onSelect(item.zone); }} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
              <View style={styles.rowCopy}>
                <View style={styles.cityLine}>
                  <Text style={[styles.city, selected && styles.citySelected]} numberOfLines={1}>{item.city}</Text>
                  {item.zone === device && <Text style={styles.deviceTag}>DEVICE</Text>}
                </View>
                <Text style={styles.region} numberOfLines={1}>{item.region}</Text>
              </View>
              <Text style={[styles.offset, selected && styles.citySelected]}>{item.offset}</Text>
              <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>
            </Pressable>;
          }}
        />
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const useStyles = makeStyles((Palette, _, scheme) => {
  const dark = scheme === 'dark';
  return {
    backdrop: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
    dismiss: { flex: 1 },
    sheet: { backgroundColor: Palette.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 10, maxHeight: '78%', width: '100%', maxWidth: 480, alignSelf: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontFamily: Fonts.sans, color: dark ? Palette.text : '#1C1C1E', fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
    done: { minHeight: 40, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
    doneText: { fontFamily: Fonts.sans, color: Palette.purple, fontSize: 15, fontWeight: '600' },
    hint: { fontFamily: Fonts.sans, color: dark ? Palette.textSecondary : '#8E8E93', fontSize: 12, lineHeight: 17 },
    search: { fontFamily: Fonts.sans, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, fontSize: 13, fontWeight: '600', color: dark ? Palette.text : '#2F2936', backgroundColor: dark ? Palette.purpleMuted : '#F6F2FC', borderWidth: 1.5, borderColor: dark ? '#3B3354' : '#CFC5DF' },
    list: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 10, borderRadius: 12 },
    rowSelected: { backgroundColor: dark ? Palette.purpleMuted : '#F3EEFD' },
    rowCopy: { flex: 1, minWidth: 0, gap: 1 },
    cityLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    city: { fontFamily: Fonts.sans, color: dark ? Palette.text : '#2F2936', fontSize: 15, fontWeight: '600', flexShrink: 1 },
    citySelected: { color: Palette.purple },
    deviceTag: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 9, letterSpacing: 0.8, fontWeight: '700' },
    region: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 12 },
    offset: { fontFamily: Fonts.sans, color: dark ? Palette.textSecondary : '#655D70', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: dark ? '#5A5170' : '#CFC5DF', alignItems: 'center', justifyContent: 'center' },
    radioSelected: { borderColor: PURPLE_FILL },
    radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: PURPLE_FILL },
    empty: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 13, textAlign: 'center', paddingVertical: 24 },
    pressed: { opacity: 0.55 },
  };
});
