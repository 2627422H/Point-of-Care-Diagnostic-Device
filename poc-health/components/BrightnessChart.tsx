import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';

interface Props {
  data: { t: number; b: number }[];   // timestamped brightness samples
  durationMs: number;
}

const MAX_POINTS = 60;
const CHART_HEIGHT = 160;

export default function BrightnessChart({ data, durationMs }: Props) {
  if (data.length < 2) return null;

  // Downsample evenly to at most MAX_POINTS, preserving timestamps
  const step = Math.max(1, Math.floor(data.length / MAX_POINTS));
  const sampled = data.filter((_, i) => i % step === 0);

  // Labels use actual sample timestamps, not assumed equal spacing
  const labelEvery = Math.floor(sampled.length / 4);
  const labels = sampled.map((pt, i) => {
    if (i % labelEvery !== 0 && i !== sampled.length - 1) return '';
    return `${(pt.t / 1000).toFixed(1)}s`;
  });

  const chartWidth = Dimensions.get('window').width - Spacing.md * 4;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Brightness curve</Text>
      <LineChart
        data={{ labels, datasets: [{ data: sampled.map((pt) => pt.b) }] }}
        width={chartWidth}
        height={CHART_HEIGHT}
        fromZero
        yAxisSuffix=""
        yAxisLabel=""
        chartConfig={{
          backgroundGradientFrom: Colors.sectionBackground,
          backgroundGradientTo: Colors.sectionBackground,
          color: (opacity = 1) => `rgba(200, 84, 80, ${opacity})`,
          labelColor: () => Colors.textSecondary,
          strokeWidth: 2,
          propsForDots: { r: '0' },
          decimalPlaces: 0,
        }}
        bezier
        withDots={false}
        withInnerLines={false}
        withOuterLines={false}
        style={styles.chart}
      />
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>0</Text>
        <Text style={styles.axisCenter}>Brightness (0–255)</Text>
        <Text style={styles.axisLabel}>255</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.sectionBackground,
    borderRadius: Radius.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    overflow: 'hidden',
  },
  title: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginLeft: Spacing.sm,
    marginBottom: 2,
  },
  chart: {
    marginLeft: -Spacing.sm,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    marginTop: -Spacing.xs,
  },
  axisLabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  axisCenter: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
