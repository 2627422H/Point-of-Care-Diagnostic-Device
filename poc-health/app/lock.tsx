import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';

export default function LockScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);

  async function authenticate() {
    setFailed(false);
    setChecking(true);

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      // No biometrics set up on this device — skip the lock screen
      router.replace('/(tabs)');
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock your health data',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
    });

    setChecking(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else {
      setFailed(true);
    }
  }

  useEffect(() => {
    authenticate();
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>POC Health</Text>
        <Text style={styles.subtitle}>Your health data is protected.</Text>

        {checking && !failed && (
          <ActivityIndicator style={styles.spinner} color={Colors.primary} size="large" />
        )}

        {failed && (
          <>
            <Text style={styles.errorText}>Authentication failed. Please try again.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={authenticate} activeOpacity={0.8}>
              <Text style={styles.retryLabel}>Unlock</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  icon: {
    fontSize: 64,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  spinner: {
    marginTop: Spacing.lg,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  retryLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
});
