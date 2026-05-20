import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Colors, FontSize, Spacing } from '../constants/theme';
import { CYCLE_CURVE } from '../store/useAppStore';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface Props {
  currentDay?: number;
}

export default function EstrogenChart({ currentDay }: Props) {
  const labels = CYCLE_CURVE.map((p) => p.day);
  const data = CYCLE_CURVE.map((p) => p.value);

  return (
    <View style={styles.container}>
      <LineChart
        data={{
          labels,
          datasets: [{ data, strokeWidth: 2 }],
        }}
        width={SCREEN_WIDTH - Spacing.md * 4}
        height={160}
        chartConfig={{
          backgroundGradientFrom: '#fff',
          backgroundGradientTo: '#fff',
          decimalPlaces: 0,
          color: () => Colors.chartLine,
          labelColor: () => Colors.textSecondary,
          propsForDots: {
            r: '3',
            strokeWidth: '1',
            stroke: Colors.border,
            fill: Colors.border,
          },
          propsForBackgroundLines: {
            stroke: Colors.border,
            strokeDasharray: '4,4',
          },
        }}
        bezier
        withInnerLines
        withOuterLines={false}
        style={styles.chart}
        getDotColor={(_, index) => {
          const day = CYCLE_CURVE[index]?.day;
          return currentDay && day === `D${currentDay}` ? Colors.primaryDark : Colors.border;
        }}
        getDotSize={(_, index) => {
          const day = CYCLE_CURVE[index]?.day;
          return currentDay && day === `D${currentDay}` ? 7 : 3;
        }}
      />
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.border }]} />
          <Text style={styles.caption}>Estimated</Text>
        </View>
        {currentDay && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.primaryDark }]} />
            <Text style={styles.caption}>Measured · Day {currentDay}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  chart: {
    borderRadius: 8,
    marginLeft: -Spacing.md,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  caption: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
});
