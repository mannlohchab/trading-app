import type { CSSProperties, ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { useColorScheme, usePalette } from '@/hooks/use-theme';

import SpecularButtonBase from './SpecularButton.jsx';
import type { SpecularButtonProps } from './SpecularButton';

type WebSpecularProps = {
  children?: ReactNode;
  size?: SpecularButtonProps['size'];
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
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  style?: CSSProperties;
  'aria-label'?: string;
};

// Metro loads SpecularButton.jsx. TypeScript rewrites a `.jsx` import onto SpecularButton.tsx.
const WebSpecularButton = SpecularButtonBase as (props: WebSpecularProps) => ReactNode;

export default function SpecularButton({
  children,
  size,
  radius,
  tint,
  tintOpacity,
  blur,
  textColor,
  lineColor,
  baseColor,
  intensity,
  idleIntensity,
  shineSize,
  shineFade,
  thickness,
  glow,
  speed,
  followMouse,
  proximity,
  autoAnimate,
  disabled,
  onClick,
  onPress,
  className,
  type,
  style,
  accessibilityLabel,
}: SpecularButtonProps) {
  const Palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  // Fill the base component's light defaults from the active theme; `specular-button--dark` softens the CSS shadow.
  const themeClass = dark ? 'specular-button--dark' : '';
  return (
    <WebSpecularButton
      size={size}
      radius={radius}
      tint={tint ?? Palette.accent}
      tintOpacity={tintOpacity}
      blur={blur}
      textColor={textColor ?? Palette.text}
      lineColor={lineColor ?? Palette.accent}
      baseColor={baseColor ?? (dark ? '#3A4150' : '#C9CEDB')}
      intensity={intensity}
      idleIntensity={idleIntensity}
      shineSize={shineSize}
      shineFade={shineFade}
      thickness={thickness}
      glow={glow}
      speed={speed}
      followMouse={followMouse}
      proximity={proximity}
      autoAnimate={autoAnimate}
      disabled={disabled}
      onClick={onClick ?? onPress}
      className={[themeClass, className].filter(Boolean).join(' ') || undefined}
      type={type}
      aria-label={label}
      style={{ boxSizing: 'border-box', ...(StyleSheet.flatten(style) ?? {}) } as CSSProperties}
    >
      {children}
    </WebSpecularButton>
  );
}
