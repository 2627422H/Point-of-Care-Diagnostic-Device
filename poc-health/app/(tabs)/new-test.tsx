import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import ConnectionBadge from '../../components/ConnectionBadge';
import { useAppStore } from '../../store/useAppStore';
import { useBluetooth } from '../../hooks/useBluetooth';

const STEPS = [
  'Spit onto the cartage and insert it into the device',
  'Make sure POC is connected via bluetooth',
  'Press start test and wait',
  'Review your results',
];

export default function NewTestScreen() {
  const { connectionState, testStatus, device } = useAppStore();
  const { scan, disconnect, startTest } = useBluetooth();

  const isConnected = connectionState === 'connected';
  const isRunning = testStatus === 'running';
  const isScanning = connectionState === 'scanning' || connectionState === 'connecting';

  function handleMainAction() {
    if (!isConnected && !isScanning) {
      scan();
    } else if (isConnected && testStatus === 'ready') {
      startTest();
    }
  }

  const deviceStatusLabel = {
    idle: 'NOT CONNECTED',
    ready: 'READY',
    running: 'TESTING…',
    complete: 'COMPLETE',
    error: 'ERROR',
  }[testStatus];

  const buttonLabel = isRunning
    ? 'RUNNING…'
    : isScanning
    ? 'SEARCHING…'
    : isConnected && testStatus === 'ready'
    ? 'START TEST'
    : isConnected && testStatus === 'complete'
    ? 'TEST AGAIN'
    : 'CONNECT DEVICE';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.brand}>POC Health</Text>
        <ConnectionBadge state={connectionState} batteryPercent={device?.batteryPercent} />
      </View>

      {/* Device status + CTA */}
      <View style={styles.statusRow}>
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Device Status</Text>
          <Text style={styles.statusValue}>{deviceStatusLabel}</Text>
        </View>
        <TouchableOpacity
          style={[styles.startButton, (isRunning || isScanning) && styles.startButtonDisabled]}
          onPress={handleMainAction}
          disabled={isRunning || isScanning}
          activeOpacity={0.8}
        >
          {(isRunning || isScanning) ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <Text style={styles.startLabel}>{buttonLabel}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Instructions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>HOW TO RUN A TEST</Text>
        {STEPS.map((step, i) => (
          <View key={i} style={styles.step}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {isConnected && (
        <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
          <Text style={styles.disconnectLabel}>Disconnect device</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  statusBox: {
    flex: 1,
    padding: Spacing.md,
    gap: 6,
    backgroundColor: Colors.sectionBackground,
  },
  statusLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  statusValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  startButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    minHeight: 100,
  },
  startButtonDisabled: {
    backgroundColor: Colors.primaryLight,
  },
  startLabel: {
    fontSize: FontSize.xl,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.sectionBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  stepNumber: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: FontSize.sm,
  },
  stepText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  disconnectButton: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  disconnectLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
