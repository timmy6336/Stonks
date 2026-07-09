import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time crashes (e.g. a stray symbol from Yahoo returning an unexpected shape)
 * so one bad stock can't take down the whole app — shows a recoverable screen instead.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Ionicons name="warning-outline" size={36} color="#c0392b" />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Pressable style={styles.button} onPress={() => this.setState({ error: null })}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#0f172a', gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  message: { color: '#cbd5e1', textAlign: 'center' },
  button: { marginTop: 12, backgroundColor: '#0a7d32', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
});
