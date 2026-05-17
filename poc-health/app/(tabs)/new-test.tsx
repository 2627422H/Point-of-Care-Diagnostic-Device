import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import ConnectionBadge from '../../components/ConnectionBadge';
import { useAppStore } from '../../store/useAppStore';
import { useStreamSession, type StreamPhase } from '../../hooks/useStreamSession';
import MjpegAnalyzer from '../../components/MjpegAnalyzer';

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle:         'READY',
  scanning:     'SCANNING…',
  ble_connected:'DEVICE FOUND',
  wifi_setup:   'WIFI NEEDED',
  provisioning: 'CONNECTING WIFI…',
  connecting:   'STARTING CAMERA…',
  streaming:    'STREAMING',
  complete:     'COMPLETE',
  error:        'ERROR',
};

const PHASE_DESCRIPTION: Partial<Record<StreamPhase, string>> = {
  scanning:     'Scanning for POC device via Bluetooth…',
  ble_connected:'Device found. Checking WiFi credentials…',
  provisioning: 'Sending WiFi credentials to device…',
  connecting:   'Device is connecting to the camera stream…',
  streaming:    'Receiving live camera data.',
  complete:     'Session complete.',
};

export default function NewTestScreen() {
  const { connectionState, device } = useAppStore();
  const {
    phase,
    streamUrl,
    frameCount,
    fps,
    errorMessage,
    streamError,
    bleMode,
    start,
    stop,
    reset,
    submitWifiCredentials,
    handleFrame,
    handleStreamError,
  } = useStreamSession();

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isIdle      = phase === 'idle';
  const isStreaming  = phase === 'streaming';
  const isComplete   = phase === 'complete';
  const isError      = phase === 'error';
  const isWifiSetup  = phase === 'wifi_setup';
  const isBusy       = ['scanning', 'ble_connected', 'provisioning', 'connecting'].includes(phase);

  function handleMainButton() {
    if (isIdle || isComplete || isError) {
      reset();
      start();
    } else if (isStreaming) {
      stop();
    }
  }

  function handleWifiSubmit() {
    if (ssid.trim() && password.trim()) {
      submitWifiCredentials(ssid.trim(), password.trim());
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.brand}>POC Health</Text>
            <ConnectionBadge state={connectionState} batteryPercent={device?.batteryPercent} />
          </View>

          {/* Status row */}
          <View style={styles.statusRow}>
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>Status</Text>
              <Text style={styles.statusValue}>{PHASE_LABEL[phase]}</Text>
              {PHASE_DESCRIPTION[phase] && (
                <Text style={styles.statusDesc}>{PHASE_DESCRIPTION[phase]}</Text>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.actionButton,
                isBusy && styles.actionButtonDisabled,
                isStreaming && styles.actionButtonStop,
              ]}
              onPress={handleMainButton}
              disabled={isBusy || isWifiSetup}
              activeOpacity={0.8}
            >
              {isBusy ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <>
                  <Ionicons
                    name={isStreaming ? 'stop-circle' : 'play-circle'}
                    size={32}
                    color="#fff"
                  />
                  <Text style={styles.actionLabel}>
                    {isStreaming ? 'STOP' : isComplete ? 'AGAIN' : isError ? 'RETRY' : 'START'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* WiFi setup form — shown once on first use */}
          {isWifiSetup && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>WiFi Setup</Text>
              <Text style={styles.cardDesc}>
                Enter your WiFi credentials once. They will be stored on the device and used
                automatically from now on.
              </Text>

              <Text style={styles.fieldLabel}>Network name (SSID)</Text>
              <TextInput
                style={styles.input}
                value={ssid}
                onChangeText={setSsid}
                placeholder="e.g. MyHomeWifi"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={[styles.fieldLabel, { marginTop: Spacing.sm }]}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="WiFi password"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((v) => !v)}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.submitButton, (!ssid.trim() || !password.trim()) && styles.submitButtonDisabled]}
                onPress={handleWifiSubmit}
                disabled={!ssid.trim() || !password.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.submitLabel}>CONNECT</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Hidden frame counter — parses MJPEG stream, notifies on each frame */}
          {isStreaming && streamUrl && (
            <MjpegAnalyzer
              streamUrl={streamUrl}
              onFrame={handleFrame}
              onError={handleStreamError}
            />
          )}

          {/* Stream debug panel */}
          {isStreaming && (
            <View style={styles.debugCard}>
              <View style={styles.debugRow}>
                <Ionicons name="bluetooth" size={16} color={Colors.primary} />
                <Text style={styles.debugLabel}>Mode</Text>
                <Text style={styles.debugValue}>{bleMode ? 'BLE (real)' : 'Mock (no device)'}</Text>
              </View>
              <View style={styles.debugRow}>
                <Ionicons name="wifi" size={16} color={Colors.primary} />
                <Text style={styles.debugLabel}>Stream URL</Text>
                <Text style={styles.debugValue} numberOfLines={1}>
                  {streamUrl ?? 'not received'}
                </Text>
              </View>
              <View style={styles.debugRow}>
                <Ionicons name="film-outline" size={16} color={Colors.primary} />
                <Text style={styles.debugLabel}>Frames</Text>
                <Text style={styles.debugValue}>{frameCount}</Text>
              </View>
              <View style={styles.debugRow}>
                <Ionicons name="speedometer-outline" size={16} color={Colors.primary} />
                <Text style={styles.debugLabel}>FPS</Text>
                <Text style={styles.debugValue}>{fps}</Text>
              </View>
              {streamError && (
                <View style={styles.debugRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.primaryDark} />
                  <Text style={[styles.debugLabel, { color: Colors.primaryDark }]}>Error</Text>
                  <Text style={[styles.debugValue, { color: Colors.primaryDark }]} numberOfLines={2}>
                    {streamError}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Error message */}
          {phase === 'error' && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle" size={24} color={Colors.primaryDark} />
              <Text style={styles.errorText}>{errorMessage || 'An error occurred.'}</Text>
            </View>
          )}

          {/* Placeholder while waiting to stream */}
          {isBusy && (
            <View style={styles.graphPlaceholder}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.graphPlaceholderText}>Waiting for stream…</Text>
            </View>
          )}

          {/* Idle instructions */}
          {isIdle && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>HOW IT WORKS</Text>
              {[
                'Insert the cartridge into the device.',
                'Tap START — the app connects via Bluetooth.',
                'Your WiFi credentials are sent to the device once.',
                'The camera stream starts and intensity is graphed live.',
              ].map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
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
    gap: 4,
    backgroundColor: Colors.sectionBackground,
  },
  statusLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statusValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  statusDesc: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 2,
  },
  actionButton: {
    width: 110,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    gap: 4,
    minHeight: 110,
  },
  actionButtonDisabled: {
    backgroundColor: Colors.primaryLight,
  },
  actionButtonStop: {
    backgroundColor: Colors.primaryDark,
  },
  actionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    padding: Spacing.sm,
  },
  submitButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.primaryLight,
  },
  submitLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  debugCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  debugLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    width: 90,
  },
  debugValue: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  errorCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    lineHeight: 20,
  },
  graphPlaceholder: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 160,
    justifyContent: 'center',
  },
  graphPlaceholderText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNum: {
    color: '#fff',
    fontWeight: '700',
    fontSize: FontSize.xs,
  },
  stepText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
});
