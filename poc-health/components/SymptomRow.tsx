import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';
import type { Symptom } from '../types';

const severityColor: Record<string, string> = {
  None: Colors.textMuted,
  Mild: Colors.primaryLight,
  Moderate: Colors.primary,
  High: Colors.primaryDark,
};

interface Props {
  symptom: Symptom;
}

export default function SymptomRow({ symptom }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.icon}>{symptom.icon}</Text>
      <View style={styles.info}>
        <Text style={styles.name}>{symptom.name}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${symptom.value * 100}%`, backgroundColor: severityColor[symptom.severity] }]} />
        </View>
      </View>
      <Text style={[styles.severity, { color: severityColor[symptom.severity] }]}>{symptom.severity}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  icon: {
    fontSize: 18,
    width: 26,
    textAlign: 'center',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  track: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.progressTrack,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  severity: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    width: 60,
    textAlign: 'right',
  },
});
