import { Stack } from 'expo-router';

import { WorkoutErrorBoundary } from '@/components/workout-error-boundary';
import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export default function WorkoutLayout() {
  return (
    <WorkoutErrorBoundary label="Workout">
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontSize: 22, fontWeight: '700' },
          headerBackTitle: 'Workout',
          contentStyle: { backgroundColor: palette.background },
        }}>
        <Stack.Screen name="select" options={{ title: 'Choose Workout' }} />
        <Stack.Screen name="[sessionId]" options={{ title: 'Workout' }} />
      </Stack>
    </WorkoutErrorBoundary>
  );
}
