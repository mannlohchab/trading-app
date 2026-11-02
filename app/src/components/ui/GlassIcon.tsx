import { Image } from 'expo-image';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

const GlassPressedContext = createContext(false);

// Share the button's native press state with its icons, including nested ones.
export function GlassPressable({ children, ...props }: Omit<PressableProps, 'children'> & { children: ReactNode }) {
  return (
    <Pressable {...props}>
      {({ pressed }) => (
        <GlassPressedContext.Provider value={pressed}>
          {children}
        </GlassPressedContext.Provider>
      )}
    </Pressable>
  );
}

// Nucleo Glass artwork. Bundled PNGs preserve the original SVG blur on native.
const ICONS = {
  home: {
    neutral: require('../../../assets/icons/nucleo-glass/house.png'),
    purple: require('../../../assets/icons/nucleo-glass/house-selected.png'),
  },
  community: {
    neutral: require('../../../assets/icons/nucleo-glass/users.png'),
    purple: require('../../../assets/icons/nucleo-glass/users-selected.png'),
  },
  analytics: {
    neutral: require('../../../assets/icons/nucleo-glass/circle-chart-line.png'),
    purple: require('../../../assets/icons/nucleo-glass/circle-chart-line-selected.png'),
  },
  profile: {
    neutral: require('../../../assets/icons/nucleo-glass/user.png'),
    purple: require('../../../assets/icons/nucleo-glass/user-selected.png'),
  },
  wallet: {
    neutral: require('../../../assets/icons/nucleo-glass/wallet-content.png'),
    purple: require('../../../assets/icons/nucleo-glass/wallet-content-selected.png'),
  },
  send: {
    neutral: require('../../../assets/icons/nucleo-glass/paper-plane.png'),
    purple: require('../../../assets/icons/nucleo-glass/paper-plane-selected.png'),
  },
  card: {
    neutral: require('../../../assets/icons/nucleo-glass/credit-cards.png'),
    purple: require('../../../assets/icons/nucleo-glass/credit-cards-selected.png'),
  },
  add: {
    neutral: require('../../../assets/icons/nucleo-glass/circle-copy-plus.png'),
    purple: require('../../../assets/icons/nucleo-glass/circle-copy-plus-selected.png'),
  },
  up: {
    neutral: require('../../../assets/icons/nucleo-glass/circle-arrow-up.png'),
    purple: require('../../../assets/icons/nucleo-glass/circle-arrow-up-selected.png'),
  },
  down: {
    neutral: require('../../../assets/icons/nucleo-glass/circle-arrow-down.png'),
    purple: require('../../../assets/icons/nucleo-glass/circle-arrow-down-selected.png'),
  },
  chart: {
    neutral: require('../../../assets/icons/nucleo-glass/square-chart-line.png'),
    purple: require('../../../assets/icons/nucleo-glass/square-chart-line-selected.png'),
  },
  coin: {
    neutral: require('../../../assets/icons/nucleo-glass/circle-coin.png'),
    purple: require('../../../assets/icons/nucleo-glass/circle-coin-selected.png'),
  },
} as const;

export type GlassIconName = keyof typeof ICONS;

const ACCENT_ICONS: Partial<Record<GlassIconName, Partial<Record<'orange' | 'blue', number>>>> = {
  send: {
    orange: require('../../../assets/icons/nucleo-glass/paper-plane-orange.png'),
    blue: require('../../../assets/icons/nucleo-glass/paper-plane-blue.png'),
  },
  community: { blue: require('../../../assets/icons/nucleo-glass/users-blue.png') },
  profile: { blue: require('../../../assets/icons/nucleo-glass/user-blue.png') },
};

type Props = {
  name: GlassIconName;
  size?: number;
  tone?: 'neutral' | 'purple' | 'orange' | 'blue';
  rotation?: number;
};

export function GlassIcon({ name, size = 24, tone, rotation = 0 }: Props) {
  const pressed = useContext(GlassPressedContext);
  const resolvedTone = tone ?? (pressed ? 'purple' : 'neutral');
  const source = resolvedTone === 'orange' || resolvedTone === 'blue'
    ? ACCENT_ICONS[name]?.[resolvedTone] ?? ICONS[name].neutral
    : ICONS[name][resolvedTone];
  return (
    <Image
      source={source}
      style={{ width: size, height: size, transform: [{ rotate: `${rotation}deg` }] }}
      contentFit="contain"
      accessible={false}
    />
  );
}

export function GlassDirectionIcon({ up, size = 16 }: { up: boolean; size?: number }) {
  return <GlassIcon name={up ? 'up' : 'down'} size={size} />;
}

