import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import ConnectionBadge from '../../components/ConnectionBadge';
import SymptomRow from '../../components/SymptomRow';
import EstrogenChart from '../../components/EstrogenChart';
import { useAppStore } from '../../store/useAppStore';

function daysSince(timestamp: number) {
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

export default function ResultsScreen() {
  const { results, connectionState, device } = useAppStore();
  const latest = results[0];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.brand}>POC Health</Text>
        <ConnectionBadge state={connectionState} batteryPercent={device?.batteryPercent} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {latest ? (
          <>
            {/* Summary card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>LAST TEST</Text>
                <Text style={styles.summaryValue}>{daysSince(latest.timestamp)}</Text>
                <Text style={styles.summaryUnit}>DAYS AGO</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>LAST ESTROGEN LEVEL</Text>
                <Text style={styles.summaryValue}>{latest.estrogenLevel}</Text>
                <Text style={styles.summaryUnit}>pg/ml</Text>
              </View>
            </View>

            {/* Symptom forecast */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>SYMPTOM FORECAST</Text>
              {latest.symptoms.map((s) => (
                <SymptomRow key={s.id} symptom={s} />
              ))}
            </View>

            {/* Estrogen chart */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>ESTROGEN LEVEL</Text>
              <EstrogenChart currentDay={latest.cycleDay} />
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No results yet.{'\n'}Run your first test!</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  brand: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  summaryCol: {
    flex: 1,
  },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: FontSize.hero,
    fontWeight: '700',
    color: Colors.primary,
    lineHeight: 56,
  },
  summaryUnit: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 28,
  },
});
