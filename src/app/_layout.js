import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { SelectionProvider, useSelection } from '../context/SelectionContext';
import {
  FOREGROUND_CHECK_INTERVAL_MS,
  addJobToAppliedList,
  addJobToManualList,
  loadBotConfig,
  loadBotStatus,
  runJobCheckNow,
  sendBotNotification,
  setupJobNotifications,
  syncBackgroundBotRegistration,
} from '../services/jobMonitorService';
import { buildEasyApplyScript } from '../scripts/linkedInEasyApplyInjection';

const SAVED_FIELDS_KEY = '@JobMail:saved_form_fields';

const CUSTOM_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

function JobMonitorCoordinator() {
  const {
    navigateToJobUrl,
    easyApplyQueue,
    activeAutoApplyJob,
    enqueueEasyApplyJobs,
    setActiveAutoApplyJob,
    popNextAutoApplyJob,
  } = useSelection();

  const hiddenWebViewRef = useRef(null);
  const timeoutRef = useRef(null);
  const [savedFields, setSavedFields] = useState([]);

  // Load saved autofill fields for Easy Apply forms
  useEffect(() => {
    async function fetchSaved() {
      try {
        const raw = await AsyncStorage.getItem(SAVED_FIELDS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setSavedFields(parsed);
        }
      } catch (_e) {}
    }
    fetchSaved();
  }, [activeAutoApplyJob]);

  // Start next queued Easy Apply job when idle
  useEffect(() => {
    if (!activeAutoApplyJob && easyApplyQueue.length > 0) {
      popNextAutoApplyJob();
    }
  }, [activeAutoApplyJob, easyApplyQueue, popNextAutoApplyJob]);

  // Safety timeout per Easy Apply job (28s)
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (activeAutoApplyJob) {
      const jobSnapshot = activeAutoApplyJob;
      timeoutRef.current = setTimeout(async () => {
        await addJobToManualList(jobSnapshot, 'Timed out — apply manually');
        setActiveAutoApplyJob(null);
      }, 28000);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [activeAutoApplyJob, setActiveAutoApplyJob]);

  const handleEasyApplyMessage = async (event) => {
    if (!activeAutoApplyJob) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'EASY_APPLY_RESULT') {
        const job = activeAutoApplyJob;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setActiveAutoApplyJob(null);

        if (data.status === 'APPLIED') {
          await addJobToAppliedList(job, data.reason || 'Easy Apply submitted by Bot');
          await sendBotNotification(
            `Bot Applied: ${job.title}`,
            `${job.company}${job.location ? ' • ' + job.location : ''}`,
            { url: job.url, jobId: job.id }
          );
        } else {
          await addJobToManualList(job, data.reason || 'Manual apply needed');
        }
      }
    } catch (_e) {}
  };

  useEffect(() => {
    let intervalId = null;

    async function runAndQueue() {
      const cfg = await loadBotConfig();
      if (!cfg.enabled) return;
      const res = await runJobCheckNow({ notify: true });
      if (cfg.autoApplyEasyApply && res?.easyApplyJobs?.length > 0) {
        enqueueEasyApplyJobs(res.easyApplyJobs);
      }
    }

    async function initMonitor() {
      const config = await loadBotConfig();
      if (config.enabled) {
        await setupJobNotifications();
        await syncBackgroundBotRegistration(true);
      }

      intervalId = setInterval(runAndQueue, FOREGROUND_CHECK_INTERVAL_MS);
    }

    initMonitor();

    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const latestConfig = await loadBotConfig();
        if (!latestConfig.enabled) return;
        const st = await loadBotStatus();
        const elapsed = Date.now() - (st.lastCheckedAt || 0);
        if (elapsed >= FOREGROUND_CHECK_INTERVAL_MS) {
          await runAndQueue();
        }
      }
    });

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
  }, [navigateToJobUrl, enqueueEasyApplyJobs]);

  if (!activeAutoApplyJob) return null;

  return (
    <View style={styles.hiddenRunner} pointerEvents="none">
      <WebView
        key={activeAutoApplyJob.id}
        ref={hiddenWebViewRef}
        source={{ uri: activeAutoApplyJob.url }}
        userAgent={CUSTOM_USER_AGENT}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        injectedJavaScript={buildEasyApplyScript(savedFields)}
        onMessage={handleEasyApplyMessage}
        onError={async () => {
          const job = activeAutoApplyJob;
          setActiveAutoApplyJob(null);
          await addJobToManualList(job, 'Page load failed — apply manually');
        }}
      />
    </View>
  );
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

const styles = StyleSheet.create({
  hiddenRunner: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -200,
    top: -200,
    opacity: 0,
    overflow: 'hidden',
  },
});
