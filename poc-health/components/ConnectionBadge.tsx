import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';
import type { ConnectionState } from '../types';

interface Props {
  state: ConnectionState;
  batteryPercent?: number;
}

export default function ConnectionBadge({ state, batteryPercent }: Props) {
  const isConnected = state === 'connected';
  const label = isConnected ? 'Connected' : state === 'scanning' ? 'Scanning…' : state === 'connecting' ? 'Connecting…' : 'Disconnected';

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: isConnected ? Colors.connected : Colors.disconnected }]} />
      <Text style={styles.label}>{label}</Text>
      {isConnected && batteryPercent !== undefined && (
        <View style={styles.battery}>
          <Text style={styles.batteryText}>{batteryPercent}%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.sectionBackground,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: '500',
  },
  battery: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  batteryText: {
    fontSize: FontSize.xs,
    color: '#fff',
    fontWeight: '600',
  },
});
