import { Platform } from 'react-native';

const tintColor = '#C6FF4D';

export const Colors = {
  light: {
    text: '#F4F4F5',
    background: '#0E0F12',
    tint: tintColor,
    icon: '#9CA3AF',
    tabIconDefault: '#6B7280',
    tabIconSelected: tintColor,
    card: '#17181C',
    border: '#2A2C33',
    muted: '#9CA3AF',
    accent: tintColor,
    accentText: '#111111',
  },
  dark: {
    text: '#F4F4F5',
    background: '#0E0F12',
    tint: tintColor,
    icon: '#9CA3AF',
    tabIconDefault: '#6B7280',
    tabIconSelected: tintColor,
    card: '#17181C',
    border: '#2A2C33',
    muted: '#9CA3AF',
    accent: tintColor,
    accentText: '#111111',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
