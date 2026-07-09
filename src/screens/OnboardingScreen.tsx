import React, { useMemo, useRef, useState } from 'react';
import { Dimensions, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    icon: 'trending-up',
    title: 'Welcome to Stonks',
    body:
      "Track stocks, get rule-based buy/sell signals, and practice trading with fake money — all on your device. There's no server behind this app; every price comes straight from public market data.",
  },
  {
    icon: 'eye',
    title: 'Watchlist & Trending',
    body:
      'Add any stock to your Watchlist by searching its name or ticker. The Trending tab surfaces what\'s hot right now, an "On sale" section for recent dips, and curated categories to browse.',
  },
  {
    icon: 'bulb',
    title: 'Signals are a starting point',
    body:
      'Each stock gets a STRONG BUY through STRONG SELL score from simple technical rules (moving averages, RSI, MACD, volume). It is not financial advice — always do your own research.',
  },
  {
    icon: 'flask',
    title: 'Practice with paper trading',
    body:
      'Buy and sell with simulated cash by default — create multiple "saves" with different starting balances. When you\'re ready, connect a free Alpaca account in Settings to enable real-money trading.',
  },
  {
    icon: 'notifications',
    title: 'Alerts & AI insights',
    body:
      'Set price or signal alerts per stock, and optionally add a free API key from Gemini, Groq, OpenRouter, or Mistral in Settings to get an AI-generated take on any stock. You can revisit all of this anytime from Settings.',
  },
];

type Props = {
  onDone: () => void;
};

export function OnboardingScreen({ onDone }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const width = Dimensions.get('window').width;
  const isLast = index === SLIDES.length - 1;

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const goNext = () => {
    if (isLast) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    setIndex(index + 1);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={slide.icon} size={40} color={colors.accent} />
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={onDone} hitSlop={8}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
        <Pressable style={styles.nextButton} onPress={goNext}>
          <Text style={styles.nextButtonText}>{isLast ? 'Get started' : 'Next'}</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    slide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    iconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 12 },
    body: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
    dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.chipBackground },
    dotActive: { backgroundColor: colors.accent, width: 20 },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingBottom: 32,
      paddingTop: 8,
    },
    skip: { color: colors.textMuted, fontWeight: '600' },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 24,
      paddingHorizontal: 22,
      paddingVertical: 12,
    },
    nextButtonText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
  });
}
