import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export default function AuthCallbackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
