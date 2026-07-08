import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortfolioStackParamList } from '../navigation/types';
import { createProfile, deleteProfile, getActiveProfileId, getProfiles, setActiveProfileId, DEFAULT_STARTING_CASH } from '../db/database';
import type { Profile } from '../types';

type Props = NativeStackScreenProps<PortfolioStackParamList, 'Profiles'>;

export function ProfilesScreen({ navigation }: Props) {
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
      ListHeaderComponent={<Text style={styles.sectionTitle}>Your saves</Text>}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => handleSwitch(item.id)} onLongPress={() => handleDelete(item)}>
          <View>
            <Text style={styles.name}>
              {item.name} {item.id === activeId ? '(active)' : ''}
            </Text>
            <Text style={styles.sub}>
              ${item.cashBalance.toFixed(2)} cash · started with ${item.startingCash.toFixed(2)}
            </Text>
          </View>
          {item.id === activeId && <Text style={styles.activeBadge}>ACTIVE</Text>}
        </Pressable>
      )}
      ListFooterComponent={
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Start a new save</Text>
          <TextInput style={styles.input} placeholder="Save name (e.g. Aggressive growth)" value={newName} onChangeText={setNewName} />
          <TextInput
            style={styles.input}
            placeholder="Starting cash"
            keyboardType="numeric"
            value={newStartingCash}
            onChangeText={setNewStartingCash}
          />
          {formError && <Text style={styles.error}>{formError}</Text>}
          <Pressable style={styles.createButton} onPress={handleCreate} disabled={creating}>
            {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createButtonText}>Create save</Text>}
          </Pressable>
          <Text style={styles.hint}>Tap a save to switch to it. Long-press to delete it.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  name: { fontWeight: '700', fontSize: 15 },
  sub: { color: '#666', fontSize: 12, marginTop: 2 },
  activeBadge: { color: '#0a7d32', fontWeight: '700', fontSize: 12 },
  card: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginTop: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  createButton: { backgroundColor: '#0a7d32', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  createButtonText: { color: '#fff', fontWeight: '700' },
  error: { color: '#c0392b', marginBottom: 8 },
  hint: { color: '#888', fontSize: 12, marginTop: 10, textAlign: 'center' },
});
