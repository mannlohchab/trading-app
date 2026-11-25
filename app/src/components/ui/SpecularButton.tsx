import type { ReactNode } from 'react';
import { Pressable, type AccessibilityRole, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { makeStyles, usePalette } from '@/hooks/use-theme';

export type SpecularButtonProps = {
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  tint?: string;
  tintOpacity?: number;
  blur?: number;
  textColor?: string;
  lineColor?: string;
  baseColor?: string;
  intensity?: number;
  idleIntensity?: number;
  shineSize?: number;
  shineFade?: number;
  thickness?: number;
  glow?: number;
  speed?: number;
  followMouse?: boolean;
  proximity?: number;
  autoAnimate?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPress?: () => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
};

/** Native stand-in for the web WebGL button. Same press action, dark pill sized like the hero CTA. */
export default function SpecularButton({
  children,
  onClick,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'button',
  style,
  radius = 28,
  textColor,
}: SpecularButtonProps) {
  const styles = useStyles();
  const Palette = usePalette();
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress ?? onClick}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: radius },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      <Text style={[styles.label, { color: textColor ?? Palette.text }]}>{children}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((Palette) => ({
  button: {
    alignSelf: 'stretch',
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pressed: { backgroundColor: Palette.cardHover },
  disabled: { opacity: 0.5 },
  label: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2 },
}));
