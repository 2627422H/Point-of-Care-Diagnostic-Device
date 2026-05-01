import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import { useAppStore } from '../../store/useAppStore';

export default function ProfileScreen() {
  const { results } = useAppStore();
  const [name, setName] = useState('');
  const [cycleLength, setCycleLength] = useState('28');

  const avgEstrogen =
    results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.estrogenLevel, 0) / results.length)
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>

        {/* Avatar placeholder */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name ? name[0].toUpperCase() : '?'}</Text>
        </View>

        {/* Fields */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Your name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>Cycle length (days)</Text>
          <TextInput
            style={styles.input}
            value={cycleLength}
            onChangeText={setCycleLength}
            keyboardType="numeric"
            placeholder="28"
            placeholderTextColor={Colors.textMuted}
          />
        </View>

        {/* Stats */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>STATISTICS</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total tests run</Text>
            <Text style={styles.statValue}>{results.length}</Text>
          </View>
          {avgEstrogen !== null && (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Average estrogen</Text>
              <Text style={styles.statValue}>{avgEstrogen} pg/ml</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.sm,
  },
  avatarText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    width: '100%',
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  statValue: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.primary,
  },
});
