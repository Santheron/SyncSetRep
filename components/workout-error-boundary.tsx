import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';

const palette = Colors.dark;

type Props = {
  children: ReactNode;
  label: string;
};

type State = {
  error: Error | null;
};

export class WorkoutErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[START WORKOUT ERROR]', error);
    console.error('[WORKOUT SCREEN ERROR]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.box}>
        <Text style={styles.title}>{this.props.label} crashed</Text>
        <Text style={styles.body}>{this.state.error.name}</Text>
        <Text style={styles.body}>{this.state.error.message}</Text>
        {this.state.error.stack ? (
          <Text style={styles.stack}>{this.state.error.stack}</Text>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: palette.background,
    padding: 20,
    gap: 8,
  },
  title: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    color: palette.text,
    fontSize: 16,
  },
  stack: {
    color: palette.muted,
    fontSize: 12,
  },
});
