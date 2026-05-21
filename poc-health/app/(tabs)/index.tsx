import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import ConnectionBadge from '../../components/ConnectionBadge';
import SymptomRow from '../../components/SymptomRow';
import { useAppStore } from '../../store/useAppStore';
import type { TestResult } from '../../types';

const SCREEN_WIDTH = Dimensions.get('window').width;

function daysSince(timestamp: number) {
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildCurrentCycleData(results: TestResult[], latest: TestResult) {
  // Cycle started (latest.cycleDay - 1) days before the latest test
  const cycleStart = latest.timestamp - (latest.cycleDay - 1) * DAY_MS;
  const cycleResults = results
    .filter(r => r.timestamp >= cycleStart)
    .sort((a, b) => a.timestamp - b.timestamp);
  const labels = cycleResults.map(r => `D${r.cycleDay}`);
  return { cycleResults, labels };
}

export default function ResultsScreen() {
  const { results, connectionState, device } = useAppStore();
  const latest = results[0];
  const { cycleResults: chartData, labels: chartLabels } =
    latest ? buildCurrentCycleData(results, latest) : { cycleResults: [], labels: [] };
  const hasChart = chartData.length >= 2;
  const cycleStartDate = latest
    ? new Date(latest.timestamp - (latest.cycleDay - 1) * DAY_MS)
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>POC Health</Text>
          <Text style={styles.dateLabel}>{todayLabel()}</Text>
        </View>
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

            {/* Estrogen trend — same chart as history page */}
            {hasChart && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>ESTROGEN LEVELS — CURRENT CYCLE</Text>
                {cycleStartDate && (
                  <Text style={styles.cycleStartLabel}>Cycle started {cycleStartDate}</Text>
                )}
                <LineChart
                  data={{
                    labels: chartLabels,
                    datasets: [{ data: chartData.map((r: TestResult) => r.estrogenLevel) }],
                  }}
                  width={SCREEN_WIDTH - Spacing.md * 4}
                  height={160}
                  chartConfig={{
                    backgroundColor: Colors.cardBackground,
                    backgroundGradientFrom: Colors.cardBackground,
                    backgroundGradientTo: Colors.cardBackground,
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(200,84,80,${opacity})`,
                    labelColor: () => Colors.textSecondary,
                    propsForDots: { r: '4', strokeWidth: '2', stroke: Colors.primary },
                  }}
                  bezier
                  withInnerLines={false}
                  style={styles.chart}
                />
              </View>
            )}
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
    padding: Spacing.md,
  },
  brand: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  dateLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
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
    marginBottom: 2,
  },
  cycleStartLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },
  chart: {
    borderRadius: Radius.md,
    marginLeft: -Spacing.sm,
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
