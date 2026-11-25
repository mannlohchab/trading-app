import { createContext, useContext, type ComponentProps } from 'react';
import { Text as NativeText, TextInput as NativeTextInput } from 'react-native';

import { AppFont } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

const InsideText = createContext(false);

// Nested text inherits its parent's font, including explicit code-font overrides.
export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const nested = useContext(InsideText);
  const styles = useStyles();
  return (
    <NativeText {...props} style={[!nested && styles.defaultFont, style]}>
      <InsideText.Provider value={true}>{children}</InsideText.Provider>
    </NativeText>
  );
}

export function TextInput({ style, ...props }: ComponentProps<typeof NativeTextInput>) {
  const styles = useStyles();
  return <NativeTextInput {...props} style={[styles.defaultFont, style]} />;
}

const useStyles = makeStyles((Palette) => ({
  defaultFont: { fontFamily: AppFont, color: Palette.text },
}));
