import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortfolioStackParamList } from '../navigation/types';
import { createProfile, deleteProfile, getActiveProfileId, getProfiles, setActiveProfileId, DEFAULT_STARTING_CASH } from '../db/database';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';
import type { Profile } from '../types';

type Props = NativeStackScreenProps<PortfolioStackParamList, 'Profiles'>;

export function ProfilesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStartingCash, setNewStartingCash] = useState(String(DEFAULT_STARTING_CASH));
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, active] = await Promise.all([getProfiles(), getActiveProfileId()]);
    setProfiles(list);
    setActiveId(active);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSwitch = async (id: number) => {
    await setActiveProfileId(id);
    setActiveId(id);
  };

  const handleCreate = async () => {
    const cash = Number(newStartingCash);
    if (!newName.trim()) {
      setFormError('Give this save a name.');
      return;
    }
    if (!Number.isFinite(cash) || cash <= 0) {
      setFormError('Enter a valid starting cash amount.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      const profile = await createProfile(newName.trim(), cash);
      setNewName('');
      setNewStartingCash(String(DEFAULT_STARTING_CASH));
      await load();
      setActiveId(profile.id);
      navigation.goBack();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (profile: Profile) => {
    Alert.alert('Delete this save?', `This permanently deletes "${profile.name}" and all of its trade history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProfile(profile.id);
            await load();
          } catch (e) {
            Alert.alert('Could not delete save', (e as Error).message);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      data={profiles}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={
        <View style={styles.sectionHeader}>
          <Ionicons name="albums" size={16} color={colors.accent} />
          <Text style={styles.sectionTitle}>Your saves</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => handleSwitch(item.id)} onLongPress={() => handleDelete(item)}>
          <Ionicons
            name={item.id === activeId ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={item.id === activeId ? colors.accent : colors.border}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.sub}>
              ${item.cashBalance.toFixed(2)} cash · started with ${item.startingCash.toFixed(2)}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              handleDelete(item);
            }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </Pressable>
      )}
      ListFooterComponent={
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="add-circle" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Start a new save</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Save name (e.g. Aggressive growth)"
            placeholderTextColor={colors.textMuted}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={styles.input}
            placeholder="Starting cash"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={newStartingCash}
            onChangeText={setNewStartingCash}
          />
          {formError && <Text style={styles.error}>{formError}</Text>}
          <Pressable style={styles.createButton} onPress={handleCreate} disabled={creating}>
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                <Text style={styles.createButtonText}>Create save</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Tap a save to switch to it. Tap the trash icon (or long-press) to delete it.</Text>
        </View>
      }
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    name: { fontWeight: '700', fontSize: 15, color: colors.text },
    sub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 20 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    createButton: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    createButtonText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
    error: { color: colors.danger, marginBottom: 8 },
    hint: { color: colors.textMuted, fontSize: 12, marginTop: 10, textAlign: 'center' },
  });
}
