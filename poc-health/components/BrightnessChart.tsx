import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';

interface Props {
  data: { t: number; b: number }[];   // timestamped brightness samples
  durationMs: number;
  compact?: boolean;
}

const MAX_POINTS = 60;
const CHART_HEIGHT = 160;

export default function BrightnessChart({ data, durationMs, compact = false }: Props) {
  if (data.length < 2) return null;

  // Normalize to % of the peak brightness (max of first 20% of samples).
  // This makes curves comparable regardless of LED colour or camera exposure,
  // and ensures the chart fills its height even when the raw range is narrow.
  const baselineWindow = Math.max(1, Math.floor(data.length * 0.2));
  const peak = Math.max(...data.slice(0, baselineWindow).map((d) => d.b), 1);
  const normalised = data.map((d) => ({ t: d.t, b: Math.round((d.b / peak) * 100) }));

  // Downsample to at most MAX_POINTS
  const step = Math.max(1, Math.floor(normalised.length / MAX_POINTS));
  const sampled = normalised.filter((_, i) => i % step === 0);

  // Labels at 0 %, 25 %, 50 %, 75 %, 100 % of sample count — use real timestamps
  const labelEvery = Math.max(1, Math.floor(sampled.length / 4));
  const labels = sampled.map((pt, i) => {
    if (i === 0) return '0s';
    if (i === sampled.length - 1) return `${(pt.t / 1000).toFixed(1)}s`;
    if (i % labelEvery !== 0) return '';
    return `${(pt.t / 1000).toFixed(1)}s`;
  });

  const chartWidth = Dimensions.get('window').width - Spacing.md * (compact ? 6 : 4);

  return (
    <View style={styles.container}>
      {!compact && <Text style={styles.title}>Brightness curve (% of peak)</Text>}
      <LineChart
        data={{ labels, datasets: [{ data: sampled.map((pt) => pt.b) }] }}
        width={chartWidth}
        height={compact ? 100 : CHART_HEIGHT}
        yAxisSuffix="%"
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
});
