import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

export function Screen({ children, style, ...rest }: ScrollViewProps) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, style]}
      {...rest}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
  },
});
