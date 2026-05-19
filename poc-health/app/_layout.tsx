import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';

export default function RootLayout() {
  const router = useRouter();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Re-lock when the app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (appState.current === 'background' && next === 'active') {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (hasHardware && isEnrolled) {
          router.replace('/lock');
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [router]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} initialRouteName="lock">
        <Stack.Screen name="lock" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
