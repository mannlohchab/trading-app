import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
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

// Nucleo Isometric artwork (scripts/render-isometric-icons.py renders every tone from the bundled SVGs).
const ICONS = {
  home: {
    neutral: require('../../../assets/icons/nucleo-isometric/home.png'),
    purple: require('../../../assets/icons/nucleo-isometric/home-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/home-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/home-orange.png'),
  },
  community: {
    neutral: require('../../../assets/icons/nucleo-isometric/community.png'),
    purple: require('../../../assets/icons/nucleo-isometric/community-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/community-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/community-orange.png'),
  },
  analytics: {
    neutral: require('../../../assets/icons/nucleo-isometric/analytics.png'),
    purple: require('../../../assets/icons/nucleo-isometric/analytics-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/analytics-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/analytics-orange.png'),
  },
  profile: {
    neutral: require('../../../assets/icons/nucleo-isometric/profile.png'),
    purple: require('../../../assets/icons/nucleo-isometric/profile-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/profile-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/profile-orange.png'),
  },
  wallet: {
    neutral: require('../../../assets/icons/nucleo-isometric/wallet.png'),
    purple: require('../../../assets/icons/nucleo-isometric/wallet-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/wallet-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/wallet-orange.png'),
  },
  send: {
    neutral: require('../../../assets/icons/nucleo-isometric/send.png'),
    purple: require('../../../assets/icons/nucleo-isometric/send-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/send-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/send-orange.png'),
  },
  card: {
    neutral: require('../../../assets/icons/nucleo-isometric/card.png'),
    purple: require('../../../assets/icons/nucleo-isometric/card-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/card-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/card-orange.png'),
  },
  add: {
    neutral: require('../../../assets/icons/nucleo-isometric/add.png'),
    purple: require('../../../assets/icons/nucleo-isometric/add-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/add-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/add-orange.png'),
  },
  up: {
    neutral: require('../../../assets/icons/nucleo-isometric/up.png'),
    purple: require('../../../assets/icons/nucleo-isometric/up-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/up-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/up-orange.png'),
  },
  down: {
    neutral: require('../../../assets/icons/nucleo-isometric/down.png'),
    purple: require('../../../assets/icons/nucleo-isometric/down-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/down-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/down-orange.png'),
  },
  chart: {
    neutral: require('../../../assets/icons/nucleo-isometric/chart.png'),
    purple: require('../../../assets/icons/nucleo-isometric/chart-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/chart-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/chart-orange.png'),
  },
  coin: {
    neutral: require('../../../assets/icons/nucleo-isometric/coin.png'),
    purple: require('../../../assets/icons/nucleo-isometric/coin-selected.png'),
    blue: require('../../../assets/icons/nucleo-isometric/coin-blue.png'),
    orange: require('../../../assets/icons/nucleo-isometric/coin-orange.png'),
  },
} as const;

export type GlassIconName = keyof typeof ICONS;

// Set false to use monochrome platform symbols instead of the isometric artwork.
const USE_ARTWORK_ICONS = true;

const STANDARD_ICONS = {
  home: { ios: 'house', android: 'home', web: 'home' },
  community: { ios: 'person.2', android: 'group', web: 'group' },
  analytics: { ios: 'chart.pie', android: 'pie_chart', web: 'pie_chart' },
  profile: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  wallet: { ios: 'wallet.bifold', android: 'account_balance_wallet', web: 'account_balance_wallet' },
  send: { ios: 'paperplane', android: 'send', web: 'send' },
  card: { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  add: { ios: 'plus.circle', android: 'add_circle', web: 'add_circle' },
  up: { ios: 'arrow.up.circle', android: 'arrow_circle_up', web: 'arrow_circle_up' },
  down: { ios: 'arrow.down.circle', android: 'arrow_circle_down', web: 'arrow_circle_down' },
  chart: { ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' },
  coin: { ios: 'dollarsign.circle', android: 'monetization_on', web: 'monetization_on' },
} as const satisfies Record<GlassIconName, ComponentProps<typeof SymbolView>['name']>;

const STANDARD_COLORS = { neutral: '#475569', purple: '#0066FF', blue: '#0066FF', orange: '#F28C28' };

type Props = {
  name: GlassIconName;
  size?: number;
  tone?: 'neutral' | 'purple' | 'orange' | 'blue';
  rotation?: number;
};

export function GlassIcon({ name, size = 24, tone, rotation = 0 }: Props) {
  const pressed = useContext(GlassPressedContext);
  const resolvedTone = tone ?? (pressed ? 'purple' : 'neutral');
  if (!USE_ARTWORK_ICONS) {
    return <SymbolView
      name={STANDARD_ICONS[name]}
      size={size}
      tintColor={STANDARD_COLORS[resolvedTone]}
      type="monochrome"
      style={{ width: size, height: size, transform: [{ rotate: `${rotation}deg` }] }}
      accessible={false}
    />;
  }
  const source = ICONS[name][resolvedTone];
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

