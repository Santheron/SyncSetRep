import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function CardioLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: 22, fontWeight: '700' },
        headerBackTitle: 'Cardio',
        contentStyle: { backgroundColor: palette.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Cardio' }} />
      <Stack.Screen name="log" options={{ title: 'Log Cardio' }} />
    </Stack>
  );
}
