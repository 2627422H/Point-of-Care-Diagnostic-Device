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
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import ConnectionBadge from '../../components/ConnectionBadge';
import MjpegViewer from '../../components/MjpegViewer';
import MjpegAnalyzer from '../../components/MjpegAnalyzer';
import BrightnessChart from '../../components/BrightnessChart';
import { useAppStore } from '../../store/useAppStore';
import { useStreamSession, type StreamPhase } from '../../hooks/useStreamSession';

const CURVES = [
  { label: 'Exponential', value: 1 as const },
  { label: 'Linear',      value: 0 as const },
  { label: 'Logarithmic', value: 2 as const },
  { label: 'Sigmoid',     value: 3 as const },
] as const;

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle:          'READY',
  scanning:      'SCANNING…',
  ble_connected: 'DEVICE FOUND',
  wifi_setup:    'WIFI NEEDED',
  provisioning:  'CONNECTING WIFI…',
  connecting:    'STARTING CAMERA…',
  streaming:     'STREAMING',
  complete:      'COMPLETE',
  error:         'ERROR',
};

const PHASE_DESCRIPTION: Partial<Record<StreamPhase, string>> = {
  scanning:      'Scanning for POC device via Bluetooth…',
  ble_connected: 'Device found. Checking WiFi credentials…',
  provisioning:  'Sending WiFi credentials to device…',
  connecting:    'Device is connecting to the camera stream…',
  streaming:     'Receiving live camera data.',
  complete:      'Session complete.',
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
    connectStatus,
    bleMode,
    bytesReceived,
    setBytesReceived,
    useWebViewMode,
    webViewStatus,
    recordingState,
    recordingProgress,
    recordingFetching,
    recordingError,
    recordingResult,
    start,
    stop,
    reset,
    submitWifiCredentials,
    enableWebView,
    handleWebViewFrame,
    handleWebViewStatus,
    startRecording,
    resetRecording,
  } = useStreamSession();

  const [ssid,           setSsid]           = useState('');
  const [password,       setPassword]       = useState('');
  const [showPassword,   setShowPassword]   = useState(false);
  const [selectedCurve,  setSelectedCurve]  = useState<0|1|2|3>(1);
  const [duration,       setDuration]       = useState('10000');

  function handleUseHotspot() {
    const name = Device.deviceName ?? '';
    if (name) setSsid(name);
    // Open Personal Hotspot settings so the user can check/copy their password.
    Linking.openURL('App-Prefs:Personal_Hotspot').catch(() =>
      Linking.openURL('app-settings:')
    );
  }

  /* Manual IP fallback — lets user type the IP directly if BLE provisioning
   * delivers the wrong address or the stream URL isn't being set. */
  const [showManualIp,  setShowManualIp]  = useState(false);
  const [manualIp,      setManualIp]      = useState('');
  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);

  /* The URL we actually show — prefer manually entered over hook-provided. */
  const displayUrl = activeStreamUrl ?? streamUrl;

  const isIdle      = phase === 'idle';
  const isStreaming  = phase === 'streaming';
  const isComplete   = phase === 'complete';
  const isError      = phase === 'error';
  const isWifiSetup  = phase === 'wifi_setup';
  const isBusy       = ['scanning', 'ble_connected', 'provisioning', 'connecting'].includes(phase);

  function handleMainButton() {
    if (isIdle || isComplete || isError) {
      setActiveStreamUrl(null);
      setShowManualIp(false);
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

  function handleManualIpSubmit() {
    const ip = manualIp.trim();
    if (!ip) return;
    const url = ip.startsWith('http') ? ip : `http://${ip}/stream`;
    setActiveStreamUrl(url);
    setShowManualIp(false);
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

          {/* Status + action button */}
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

          {/* ── LIVE STREAM VIEWER ── */}
          {(isStreaming || displayUrl) && displayUrl ? (
            <View style={styles.streamCard}>
              <Text style={styles.streamCardTitle}>LIVE STREAM</Text>
              <MjpegViewer
                streamUrl={displayUrl}
                onFrame={handleWebViewFrame}
                onError={(msg) => handleWebViewStatus('error: ' + msg)}
                onStatus={handleWebViewStatus}
                onBytes={setBytesReceived}
              />
              <View style={styles.streamStats}>
                <Text style={styles.streamStat}>
                  <Text style={styles.streamStatLabel}>Frames: </Text>
                  {frameCount}
                </Text>
                <Text style={styles.streamStat}>
                  <Text style={styles.streamStatLabel}>FPS: </Text>
                  {fps}
                </Text>
                <Text style={styles.streamStat} numberOfLines={1}>
                  <Text style={styles.streamStatLabel}>Viewer: </Text>
                  {displayUrl?.replace('/stream', '/')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── RECORDING PANEL ── */}
          {isStreaming && displayUrl && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>RECORD SESSION</Text>

              {recordingState === 'idle' && (
                <>
                  <Text style={styles.fieldLabel}>Brightness curve</Text>
                  <View style={styles.curveRow}>
                    {CURVES.map((c) => (
                      <TouchableOpacity
                        key={c.value}
                        style={[styles.curveChip, selectedCurve === c.value && styles.curveChipActive]}
                        onPress={() => setSelectedCurve(c.value)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.curveChipText, selectedCurve === c.value && styles.curveChipTextActive]}>
                          {c.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Duration (ms)</Text>
                  <TextInput
                    style={styles.input}
                    value={duration}
                    onChangeText={setDuration}
                    keyboardType="number-pad"
                    placeholderTextColor={Colors.textMuted}
                  />

                  {recordingError && (
                    <View style={styles.recordingErrorRow}>
                      <Ionicons name="alert-circle-outline" size={16} color={Colors.primaryDark} />
                      <Text style={styles.recordingErrorText}>{recordingError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.submitButton, recordingFetching && styles.submitButtonDisabled]}
                    onPress={() => startRecording({
                      curve: selectedCurve,
                      duration: parseInt(duration, 10) || 10000,
                      displayUrl,
                    })}
                    disabled={recordingFetching}
                    activeOpacity={0.8}
                  >
                    {recordingFetching
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.submitLabel}>START RECORDING</Text>
                    }
                  </TouchableOpacity>
                </>
              )}

              {recordingState === 'active' && (
                <View style={styles.recordingActive}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.recordingLabel}>Recording…</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${recordingProgress * 100}%` }]} />
                  </View>
                  <Text style={styles.recordingPct}>{Math.round(recordingProgress * 100)}%</Text>
                </View>
              )}

              {recordingState === 'done' && recordingResult && (
                <View style={styles.recordingDone}>
                  <View style={styles.recordingDoneHeader}>
                    <Ionicons name="checkmark-circle" size={28} color="#4CAF50" />
                    <Text style={styles.recordingDoneTitle}>Recording complete</Text>
                  </View>

                  <View style={styles.recordingSummary}>
                    {[
                      ['Curve',    CURVES.find(c => c.value === recordingResult.curve)?.label ?? '—'],
                      ['Duration', `${(recordingResult.durationMs / 1000).toFixed(1)} s`],
                      ['Frames',   String(recordingResult.framesCapured)],
                      ['Avg FPS',  recordingResult.durationActualMs > 0
                        ? (recordingResult.framesCapured / (recordingResult.durationActualMs / 1000)).toFixed(1)
                        : '—'],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>{label}</Text>
                        <Text style={styles.summaryValue}>{value}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.recordingCurveDesc}>
                    {recordingResult.curve === 0 && 'Linear: LED dimmed at a constant rate over the session.'}
                    {recordingResult.curve === 1 && 'Exponential: fast initial drop to a long dim tail — models reagent absorption.'}
                    {recordingResult.curve === 2 && 'Logarithmic: steep drop in first 20 % then slow fade out.'}
                    {recordingResult.curve === 3 && 'Sigmoid: gradual start, fast mid-point transition, gradual end.'}
                  </Text>

                  {recordingResult.brightnessData.length >= 2 && (
                    <BrightnessChart
                      data={recordingResult.brightnessData}
                      durationMs={recordingResult.durationActualMs}
                    />
                  )}

                  <TouchableOpacity
                    style={styles.recordAgainButton}
                    onPress={resetRecording}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh" size={16} color={Colors.primary} />
                    <Text style={styles.recordAgainText}>Record again</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Manual IP entry — shown while streaming if stream URL not set,
              or toggled by the user if the stream appears blank */}
          {isStreaming && !displayUrl && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Enter Stream IP</Text>
              <Text style={styles.cardDesc}>
                If the stream URL wasn't received automatically, enter the IP
                shown on the ESP32 serial monitor (e.g. 192.168.1.81).
              </Text>
              <TextInput
                style={styles.input}
                value={manualIp}
                onChangeText={setManualIp}
                placeholder="192.168.1.81"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.submitButton, !manualIp.trim() && styles.submitButtonDisabled]}
                onPress={handleManualIpSubmit}
                disabled={!manualIp.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.submitLabel}>CONNECT TO STREAM</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Change IP button — shown when streaming with an active URL */}
          {isStreaming && displayUrl && (
            <TouchableOpacity
              style={styles.manualIpToggle}
              onPress={() => setShowManualIp((v) => !v)}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil-outline" size={16} color={Colors.primary} />
              <Text style={styles.manualIpToggleText}>
                {showManualIp ? 'Cancel' : 'Stream looks blank? Change IP'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Manual IP override input */}
          {isStreaming && displayUrl && showManualIp && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Override Stream IP</Text>
              <TextInput
                style={styles.input}
                value={manualIp}
                onChangeText={setManualIp}
                placeholder="192.168.1.81"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.submitButton, !manualIp.trim() && styles.submitButtonDisabled]}
                onPress={handleManualIpSubmit}
                disabled={!manualIp.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.submitLabel}>USE THIS IP</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* WiFi setup form */}
          {isWifiSetup && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>WiFi Setup</Text>
              <Text style={styles.cardDesc}>
                The device needs to join the same network as your phone.
              </Text>

              {/* Hotspot shortcut */}
              <TouchableOpacity style={styles.hotspotButton} onPress={handleUseHotspot} activeOpacity={0.8}>
                <Ionicons name="phone-portrait-outline" size={18} color={Colors.primary} />
                <Text style={styles.hotspotLabel}>Use this phone's hotspot</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>

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
                style={[
                  styles.submitButton,
                  (!ssid.trim() || !password.trim()) && styles.submitButtonDisabled,
                ]}
                onPress={handleWifiSubmit}
                disabled={!ssid.trim() || !password.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.submitLabel}>CONNECT</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Debug panel — hidden WebView analyzer still runs for frame counting
              when MjpegViewer is visible. Only show analyzer in non-viewer mode. */}
          {isStreaming && displayUrl && useWebViewMode && (
            <MjpegAnalyzer
              streamUrl={displayUrl}
              onFrame={handleWebViewFrame}
              onError={(msg) => handleWebViewStatus('error: ' + msg)}
              onStatus={handleWebViewStatus}
            />
          )}

          {/* Debug info */}
          {isStreaming && (
            <View style={styles.debugCard}>
              <Text style={styles.debugTitle}>DEBUG</Text>
              {[
                ['Mode',     bleMode ? 'BLE (real)' : 'Mock'],
                ['HTTP',     connectStatus ?? 'connecting…'],
                ['Bytes Rx', bytesReceived > 0 ? `${(bytesReceived / 1024).toFixed(1)} KB` : '0'],
                ['Stream',   displayUrl ?? 'not received'],
                ...(streamError ? [['Error', streamError]] : []),
                ...(webViewStatus ? [['WebView', webViewStatus]] : []),
              ].map(([label, value]) => (
                <View key={label} style={styles.debugRow}>
                  <Text style={styles.debugLabel}>{label}</Text>
                  <Text style={styles.debugValue} numberOfLines={2}>{value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Error */}
          {isError && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle" size={24} color={Colors.primaryDark} />
              <Text style={styles.errorText}>{errorMessage || 'An error occurred.'}</Text>
            </View>
          )}

          {/* Busy placeholder */}
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
                'The camera stream appears live on this screen.',
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
  safe:    { flex: 1, backgroundColor: Colors.background },
  flex:    { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },

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
  statusLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600', letterSpacing: 0.5 },
  statusValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  statusDesc:  { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 16, marginTop: 2 },

  actionButton: {
    width: 110,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
    gap: 4,
    minHeight: 110,
  },
  actionButtonDisabled: { backgroundColor: Colors.primaryLight },
  actionButtonStop:     { backgroundColor: Colors.primaryDark },
  actionLabel: { fontSize: FontSize.sm, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  streamCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  streamCardTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    paddingHorizontal: Spacing.xs,
  },
  streamStats: {
    paddingHorizontal: Spacing.xs,
    gap: 2,
  },
  streamStat: { fontSize: FontSize.xs, color: Colors.textSecondary },
  streamStatLabel: { fontWeight: '600', color: Colors.text },

  manualIpToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  manualIpToggleText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, letterSpacing: 0.5 },
  cardDesc:  { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  fieldLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  passwordRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  passwordInput:  { flex: 1 },
  eyeButton:      { padding: Spacing.sm },
  submitButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  submitButtonDisabled: { backgroundColor: Colors.primaryLight },
  submitLabel: { fontSize: FontSize.md, fontWeight: '700', color: '#fff', letterSpacing: 1 },

  debugCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  debugTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 2,
  },
  debugRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  debugLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, width: 80 },
  debugValue: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },

  errorCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },

  graphPlaceholder: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 160,
    justifyContent: 'center',
  },
  graphPlaceholderText: { fontSize: FontSize.sm, color: Colors.textMuted },

  hotspotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.sectionBackground,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hotspotLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },

  curveRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  curveChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  curveChipActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  curveChipText:      { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  curveChipTextActive:{ color: '#fff' },

  recordingErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: '#FEE2E2',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  recordingErrorText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark },

  recordingActive: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  recordingLabel:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  recordingPct:    { fontSize: FontSize.sm, color: Colors.textSecondary },

  recordingDone: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  recordingDoneHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  recordingDoneTitle:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  recordingSummary: {
    backgroundColor: Colors.sectionBackground,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    gap: 4,
  },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  summaryValue: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },

  recordingCurveDesc: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    fontStyle: 'italic',
  },

  recordAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingTop: Spacing.xs,
  },
  recordAgainText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },

  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum:  { color: '#fff', fontWeight: '700', fontSize: FontSize.xs },
  stepText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
});
