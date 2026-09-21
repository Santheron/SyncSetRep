import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export function AuthLoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={palette.accent} size="large" />
      <Text style={styles.label}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  label: {
    color: palette.muted,
    fontSize: 16,
  },
});
