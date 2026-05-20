import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';
import { fitDecay, fittedCurve, estrogenBand } from '../utils/estrogenCalibration';

interface Props {
  data: { t: number; b: number }[];
  durationMs: number;
  compact?: boolean;
  showEstrogen?: boolean;  // show fit overlay + estrogen estimate
}

const MAX_POINTS = 60;

export default function BrightnessChart({ data, durationMs, compact = false, showEstrogen = true }: Props) {
  if (data.length < 2) return null;

  const chartHeight = compact ? 100 : 170;

  // Normalise to % of peak (first 20% of samples)
  const baselineWindow = Math.max(1, Math.floor(data.length * 0.2));
  const peak = Math.max(...data.slice(0, baselineWindow).map((d) => d.b), 1);
  const normalised = data.map((d) => ({ t: d.t, b: Math.round((d.b / peak) * 100) }));

  // Fit exponential and generate overlay
  const fit = fitDecay(normalised);
  const fitted = fittedCurve(fit.lambda, normalised);

  // Downsample both to MAX_POINTS
  const step = Math.max(1, Math.floor(normalised.length / MAX_POINTS));
  const sampled       = normalised.filter((_, i) => i % step === 0);
  const sampledFitted = fitted.filter((_, i) => i % step === 0);

  const labelEvery = Math.max(1, Math.floor(sampled.length / 4));
  const labels = sampled.map((pt, i) => {
    if (i === 0) return '0s';
    if (i === sampled.length - 1) return `${(pt.t / 1000).toFixed(1)}s`;
    if (i % labelEvery !== 0) return '';
    return `${(pt.t / 1000).toFixed(1)}s`;
  });

  const chartWidth = Dimensions.get('window').width - Spacing.md * (compact ? 6 : 4);
  const band = estrogenBand(fit.estimatedEstrogen);

  return (
    <View style={styles.container}>
      {!compact && (
        <Text style={styles.title}>Brightness decay</Text>
      )}

      <LineChart
        data={{
          labels,
          datasets: [
            {
              data: sampled.map((pt) => pt.b),
              color: (opacity = 1) => `rgba(200,84,80,${opacity})`,
              strokeWidth: 2,
            },
            {
              data: sampledFitted.map((pt) => pt.b),
              color: (opacity = 1) => `rgba(100,140,255,${opacity * 0.75})`,
              strokeWidth: 1.5,
            },
          ],
        }}
        width={chartWidth}
        height={chartHeight}
        yAxisSuffix="%"
        chartConfig={{
          backgroundGradientFrom: Colors.sectionBackground,
          backgroundGradientTo: Colors.sectionBackground,
          color: (opacity = 1) => `rgba(200,84,80,${opacity})`,
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

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: 'rgba(200,84,80,1)' }]} />
          <Text style={styles.legendText}>Measured</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: 'rgba(100,140,255,0.75)' }]} />
          <Text style={styles.legendText}>Fit (λ={fit.lambda.toFixed(3)}/s, R²={fit.r2.toFixed(2)})</Text>
        </View>
      </View>

      {/* Estrogen estimate */}
      {showEstrogen && !compact && fit.estimatedEstrogen > 0 && (
        <View style={[styles.estrogenBadge, { borderColor: band.color }]}>
          <View style={styles.estrogenLeft}>
            <Text style={styles.estrogenValue}>{fit.estimatedEstrogen}</Text>
            <Text style={styles.estrogenUnit}>pg/ml</Text>
          </View>
          <View style={styles.estrogenRight}>
            <Text style={[styles.estrogenLabel, { color: band.color }]}>{band.label}</Text>
            <Text style={styles.estrogenDesc}>{band.description}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.sectionBackground,
    borderRadius: Radius.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    overflow: 'hidden',
    gap: 4,
  },
  title: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginLeft: Spacing.sm,
  },
  chart: {
    marginLeft: -Spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingBottom: 2,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLine: { width: 16, height: 3, borderRadius: 1.5 },
  legendText: { fontSize: 10, color: Colors.textSecondary },
  estrogenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.sm,
    marginTop: 2,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    gap: Spacing.sm,
  },
  estrogenLeft: { alignItems: 'center', minWidth: 48 },
  estrogenValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  estrogenUnit: { fontSize: FontSize.xs, color: Colors.textSecondary },
  estrogenRight: { flex: 1, gap: 2 },
  estrogenLabel: { fontSize: FontSize.sm, fontWeight: '700' },
  estrogenDesc: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
