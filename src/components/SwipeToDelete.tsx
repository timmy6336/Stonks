import React, { useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const REVEAL_WIDTH = 76;
const OPEN_THRESHOLD = REVEAL_WIDTH / 2;

type Props = {
  onDelete: () => void;
  children: React.ReactNode;
};

/** Swipe-left-to-reveal-delete, built on plain Animated + PanResponder (no gesture-handler/reanimated needed). */
export function SwipeToDelete({ onDelete, children }: Props) {
  const { colors } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapTo = (toValue: number) => {
    openRef.current = toValue !== 0;
    Animated.spring(translateX, { toValue, useNativeDriver: true, bounciness: 0 }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_, gesture) => {
        const base = openRef.current ? -REVEAL_WIDTH : 0;
        const next = Math.min(0, Math.max(-REVEAL_WIDTH, base + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const base = openRef.current ? -REVEAL_WIDTH : 0;
        const current = base + gesture.dx;
        snapTo(current < -OPEN_THRESHOLD ? -REVEAL_WIDTH : 0);
      },
    })
  ).current;

  const handleDelete = () => {
    snapTo(0);
    onDelete();
  };

  return (
    <View style={styles.container}>
      <View style={[styles.deleteBackground, { backgroundColor: colors.danger }]}>
        <Pressable onPress={handleDelete} style={styles.deleteButton} hitSlop={8}>
          <Ionicons name="trash" size={20} color="#fff" />
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX }], backgroundColor: colors.background }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  deleteBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  deleteButton: { width: REVEAL_WIDTH, alignItems: 'center', justifyContent: 'center', height: '100%' },
});
