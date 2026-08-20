import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ProgramLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: 22, fontWeight: '700' },
        headerBackTitle: 'Program',
        contentStyle: { backgroundColor: palette.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Program' }} />
      <Stack.Screen name="[id]" options={{ title: 'Workout Day' }} />
    </Stack>
  );
}
