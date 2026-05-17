import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import { useAppStore } from '../../store/useAppStore';
import type { TestResult } from '../../types';

const SCREEN_WIDTH = Dimensions.get('window').width;

const SEVERITY_COLORS: Record<string, string> = {
  None: Colors.textMuted,
  Mild: '#FFA726',
  Moderate: '#EF6C00',
  High: Colors.primary,
};

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function estrogenBadgeColor(level: number): string {
  if (level >= 420) return Colors.primary;
  if (level >= 200) return '#EF6C00';
  return Colors.textMuted;
}

function ResultRow({
  result,
  onPress,
  expanded,
}: {
  result: TestResult;
  onPress: () => void;
  expanded: boolean;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.rowMain}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowDate}>{formatDate(result.timestamp)}</Text>
          <Text style={styles.rowCycleDay}>Cycle day {result.cycleDay}</Text>
        </View>
        <View style={[styles.estrogenBadge, { backgroundColor: estrogenBadgeColor(result.estrogenLevel) }]}>
          <Text style={styles.estrogenBadgeText}>{Math.round(result.estrogenLevel)}</Text>
          <Text style={styles.estrogenUnit}>pg/ml</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.symptomsExpanded}>
          {result.symptoms.map((s) => (
            <View key={s.id} style={styles.symptomLine}>
              <Text style={styles.symptomIcon}>{s.icon}</Text>
              <Text style={styles.symptomName}>{s.name}</Text>
              <Text style={[styles.severityLabel, { color: SEVERITY_COLORS[s.severity] ?? Colors.text }]}>
                {s.severity}
              </Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const { results } = useAppStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);

  const hasEnoughForChart = sorted.length >= 2;
  const chartData = sorted.slice().reverse(); // oldest first for left-to-right trend

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={sorted}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>History</Text>

            {hasEnoughForChart ? (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>ESTROGEN TREND</Text>
                <LineChart
                  data={{
                    labels: chartData.map((r) => `D${r.cycleDay}`),
                    datasets: [{ data: chartData.map((r) => r.estrogenLevel) }],
                  }}
                  width={SCREEN_WIDTH - Spacing.md * 2 - Spacing.md * 2}
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
                  style={styles.chart}
                  withInnerLines={false}
                />
              </View>
            ) : (
              <View style={styles.chartPlaceholder}>
                <Text style={styles.chartPlaceholderText}>
                  Run at least 2 tests to see your estrogen trend.
                </Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>ALL TESTS</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No tests recorded yet.</Text>
            <Text style={styles.emptySubtext}>Run your first test from the New Test tab.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ResultRow
            result={item}
            expanded={expandedId === item.id}
            onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
          />
        )}
      />
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
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  chartCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  chartTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  chart: {
    borderRadius: Radius.md,
    marginLeft: -Spacing.sm,
  },
  chartPlaceholder: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  chartPlaceholderText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  row: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    gap: 2,
  },
  rowDate: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  rowCycleDay: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  estrogenBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    minWidth: 64,
  },
  estrogenBadgeText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },
  estrogenUnit: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
  },
  symptomsExpanded: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: 6,
  },
  symptomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  symptomIcon: {
    fontSize: 16,
    width: 22,
  },
  symptomName: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  severityLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
