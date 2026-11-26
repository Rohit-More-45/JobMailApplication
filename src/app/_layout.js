import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { SelectionProvider, useSelection } from '../context/SelectionContext';
import {
  FOREGROUND_CHECK_INTERVAL_MS,
  loadBotConfig,
  loadBotStatus,
  runJobCheckNow,
  setupJobNotifications,
  syncBackgroundBotRegistration,
} from '../services/jobMonitorService';

function JobMonitorCoordinator() {
  const { navigateToJobUrl } = useSelection();

  useEffect(() => {
    let intervalId = null;

    async function initMonitor() {
      const config = await loadBotConfig();
      if (config.enabled) {
        await setupJobNotifications();
        await syncBackgroundBotRegistration(true);
      }

      // 5-minute foreground refresh loop while app is open
      intervalId = setInterval(async () => {
        const latestConfig = await loadBotConfig();
        if (latestConfig.enabled) {
          await runJobCheckNow({ notify: true });
        }
      }, FOREGROUND_CHECK_INTERVAL_MS);
    }

    initMonitor();

    // Check immediately on foreground resume if >= 5 minutes have elapsed
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const latestConfig = await loadBotConfig();
        if (!latestConfig.enabled) return;
        const st = await loadBotStatus();
        const elapsed = Date.now() - (st.lastCheckedAt || 0);
        if (elapsed >= FOREGROUND_CHECK_INTERVAL_MS) {
          await runJobCheckNow({ notify: true });
        }
      }
    });

    // Tapping a job alert notification opens that job in the LinkedIn tab
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response?.notification?.request?.content?.data?.url;
      if (url && typeof url === 'string') {
        navigateToJobUrl(url);
      }
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
      appStateSub.remove();
      notifSub.remove();
    };
  }, [navigateToJobUrl]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SelectionProvider>
        <JobMonitorCoordinator />
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </SelectionProvider>
    </SafeAreaProvider>
  );
}
