import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SignalScore } from '../types';

const COLORS: Record<SignalScore, string> = {
  STRONG_BUY: '#0a7d32',
  BUY: '#3fa34d',
  HOLD: '#8a8a8a',
  SELL: '#d9822b',
  STRONG_SELL: '#c0392b',
};

const LABELS: Record<SignalScore, string> = {
  STRONG_BUY: 'STRONG BUY',
  BUY: 'BUY',
  HOLD: 'HOLD',
  SELL: 'SELL',
  STRONG_SELL: 'STRONG SELL',
};

const ICONS: Record<SignalScore, keyof typeof Ionicons.glyphMap> = {
  STRONG_BUY: 'trending-up',
  BUY: 'trending-up',
  HOLD: 'remove',
  SELL: 'trending-down',
  STRONG_SELL: 'trending-down',
};

export function SignalBadge({ score }: { score: SignalScore }) {
  return (
    <View style={[styles.badge, { backgroundColor: COLORS[score] }]}>
      <Ionicons name={ICONS[score]} size={12} color="#fff" />
      <Text style={styles.text}>{LABELS[score]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
