import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';
import type { IntensityPoint } from '../hooks/useStreamSession';

interface Props {
  data: IntensityPoint[];
  maxPoints?: number;
}

const CHART_WIDTH = Dimensions.get('window').width - Spacing.md * 4;

const CHANNELS = [
  { key: 'r' as const, label: 'Red',   color: 'rgba(210,50,50',   dot: '#D23232' },
  { key: 'g' as const, label: 'Green', color: 'rgba(40,170,60',   dot: '#28AA3C' },
  { key: 'b' as const, label: 'Blue',  color: 'rgba(50,100,220',  dot: '#3264DC' },
];

export default function IntensityGraph({ data, maxPoints = 50 }: Props) {
  const recent = data.slice(-maxPoints);

  if (recent.length < 2) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Waiting for stream data…</Text>
      </View>
    );
  }

  // Pad all datasets to the same length (LineChart requirement)
  const len = recent.length;
  const labels = recent.map((_, i) => (i === 0 || i === len - 1 || i % 10 === 9 ? `${i + 1}s` : ''));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LIGHT INTENSITY</Text>

      <LineChart
        data={{
          labels,
          datasets: CHANNELS.map((ch) => ({
            data: recent.map((p) => Math.max(0, Math.min(255, p[ch.key]))),
            color: (opacity = 1) => `${ch.color},${opacity})`,
            strokeWidth: 2,
          })),
        }}
        width={CHART_WIDTH}
        height={200}
        chartConfig={{
          backgroundColor: Colors.cardBackground,
          backgroundGradientFrom: Colors.cardBackground,
          backgroundGradientTo: Colors.cardBackground,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(100,100,100,${opacity})`,
          labelColor: () => Colors.textSecondary,
          propsForBackgroundLines: { stroke: Colors.border },
        }}
        withDots={false}
        withInnerLines={true}
        withOuterLines={false}
        style={styles.chart}
        yAxisSuffix=""
        fromZero={false}
      />

      <View style={styles.legend}>
        {CHANNELS.map(({ label, dot }) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: dot }]} />
            <Text style={styles.legendLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  title: {
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
  placeholder: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  placeholderText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
});
