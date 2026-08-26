import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

const FitnessDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.accent,
    background: palette.background,
    card: palette.background,
    text: palette.text,
    border: palette.border,
    notification: palette.accent,
  },
};

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={FitnessDarkTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="workout" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
