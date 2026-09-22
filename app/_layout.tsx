import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AuthLoadingScreen } from '@/components/auth-loading';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { DeepLinkBridge } from '@/lib/auth-deep-link';

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

function RootNavigator() {
  const { session, isLoading, isPasswordRecovery } = useAuth();

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!session && !isPasswordRecovery}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workout" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={isPasswordRecovery}>
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!session && !isPasswordRecovery}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="sign-up" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack>
      {isLoading ? (
        <View pointerEvents="auto" style={styles.loadingOverlay}>
          <AuthLoadingScreen />
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <DeepLinkBridge />
      <ThemeProvider value={FitnessDarkTheme}>
        <RootNavigator />
        <StatusBar style="light" />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.background,
    zIndex: 100,
  },
});
