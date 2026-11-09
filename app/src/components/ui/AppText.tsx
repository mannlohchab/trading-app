import { createContext, useContext, type ComponentProps } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput } from 'react-native';

import { AppFont, Palette } from '@/constants/theme';

const InsideText = createContext(false);

// Nested text inherits its parent's font, including explicit code-font overrides.
export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const nested = useContext(InsideText);
  return (
    <NativeText {...props} style={[!nested && styles.defaultFont, style]}>
      <InsideText.Provider value={true}>{children}</InsideText.Provider>
    </NativeText>
  );
}

export function TextInput({ style, ...props }: ComponentProps<typeof NativeTextInput>) {
  return <NativeTextInput {...props} style={[styles.defaultFont, style]} />;
}

const styles = StyleSheet.create({
  defaultFont: { fontFamily: AppFont, color: Palette.text },
});
