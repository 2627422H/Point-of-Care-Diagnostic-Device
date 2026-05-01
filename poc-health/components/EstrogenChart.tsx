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
            r: '4',
            strokeWidth: '2',
            stroke: Colors.primary,
            fill: Colors.primary,
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
          return currentDay && day === `D${currentDay}` ? Colors.primaryDark : Colors.primary;
        }}
      />
      {currentDay && (
        <Text style={styles.caption}>Current: Day {currentDay}</Text>
      )}
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
  caption: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
});
