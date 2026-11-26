import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Platform, Alert } from 'react-native';
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
  buildLinkedInBrowserSearchUrl,
  loadBotConfig,
  loadBotStatus,
  processFetchedJobs,
  recordBotCheckError,
  runJobCheckNow,
  sendBotNotification,
  setupJobNotifications,
  syncBackgroundBotRegistration,
} from '../services/jobMonitorService';
import { buildEasyApplyScript } from '../scripts/linkedInEasyApplyInjection';
import { LINKEDIN_SEARCH_EXTRACTION_SCRIPT } from '../scripts/linkedInSearchInjection';

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
    searchRequest,
    triggerBotSearch,
    clearBotSearch,
    notifyBotDataUpdated,
  } = useSelection();

  const applyTimeoutRef = useRef(null);
  const searchTimeoutRef = useRef(null);
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
    if (applyTimeoutRef.current) {
      clearTimeout(applyTimeoutRef.current);
      applyTimeoutRef.current = null;
    }

    if (activeAutoApplyJob) {
      const jobSnapshot = activeAutoApplyJob;
      applyTimeoutRef.current = setTimeout(async () => {
        await addJobToManualList(jobSnapshot, 'Timed out — apply manually');
        setActiveAutoApplyJob(null);
        notifyBotDataUpdated();
      }, 28000);
    }

    return () => {
      if (applyTimeoutRef.current) {
        clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = null;
      }
    };
  }, [activeAutoApplyJob, setActiveAutoApplyJob, notifyBotDataUpdated]);

  // Safety timeout for WebView search (22s)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    if (searchRequest) {
      const reqSnapshot = searchRequest;
      searchTimeoutRef.current = setTimeout(async () => {
        clearBotSearch();
        // Fallback to single guest fetch if WebView timed out
        const res = await runJobCheckNow({ notify: reqSnapshot.notify });
        notifyBotDataUpdated();
        if (reqSnapshot.showAlert) {
          if (res.status?.lastError) {
            Alert.alert('Search Issue', res.status.lastError);
          } else {
            Alert.alert('Search Complete', `Found ${res.totalFetched || 0} matching jobs.`);
          }
        }
      }, 22000);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [searchRequest, clearBotSearch, notifyBotDataUpdated]);

  const handleSearchWebViewMessage = async (event) => {
    if (!searchRequest) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'JOB_SEARCH_RESULTS') {
        const reqSnapshot = searchRequest;
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }
        clearBotSearch();

        const cfg = await loadBotConfig();
        let res;

        if (data.error === 'AUTH_REQUIRED') {
          // Not logged in inside WebView: try single guest fetch fallback
          res = await runJobCheckNow({ notify: reqSnapshot.notify });
        } else {
          res = await processFetchedJobs(data.jobs || [], { notify: reqSnapshot.notify });
        }

        if (cfg.autoApplyEasyApply && res?.easyApplyJobs?.length > 0) {
          enqueueEasyApplyJobs(res.easyApplyJobs);
        }
        notifyBotDataUpdated();

        if (reqSnapshot.showAlert) {
          if (res?.status?.lastError) {
            Alert.alert('Search Issue', res.status.lastError);
          } else {
            const easyCount = (res?.easyApplyJobs || []).length;
            Alert.alert(
              'LinkedIn Search Complete',
              `Found ${res?.totalFetched || 0} matching jobs${easyCount > 0 ? ` (${easyCount} Easy Apply)` : ''}.`
            );
          }
        }
      }
    } catch (_e) {}
  };

  const handleEasyApplyMessage = async (event) => {
    if (!activeAutoApplyJob) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'EASY_APPLY_RESULT') {
        const job = activeAutoApplyJob;
        if (applyTimeoutRef.current) {
          clearTimeout(applyTimeoutRef.current);
          applyTimeoutRef.current = null;
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
        notifyBotDataUpdated();
      }
    } catch (_e) {}
  };

  useEffect(() => {
    let intervalId = null;

    async function runForegroundSearch() {
      const cfg = await loadBotConfig();
      if (!cfg.enabled) return;
      if (!cfg.keywords?.trim() && !cfg.customUrl?.trim()) return;
      const url = buildLinkedInBrowserSearchUrl(cfg);
      triggerBotSearch(url, { notify: true, showAlert: false });
    }

    async function initMonitor() {
      const config = await loadBotConfig();
      if (config.enabled) {
        await setupJobNotifications();
        await syncBackgroundBotRegistration(true);
      }

      intervalId = setInterval(runForegroundSearch, FOREGROUND_CHECK_INTERVAL_MS);
    }

    initMonitor();

    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const latestConfig = await loadBotConfig();
        if (!latestConfig.enabled) return;
        const st = await loadBotStatus();
        const elapsed = Date.now() - (st.lastCheckedAt || 0);
        if (elapsed >= FOREGROUND_CHECK_INTERVAL_MS) {
          await runForegroundSearch();
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
  }, [navigateToJobUrl, triggerBotSearch]);

  return (
    <>
      {/* Hidden WebView 1: Logged-In LinkedIn Browser Search Extractor */}
      {searchRequest && (
        <View style={styles.hiddenRunner} pointerEvents="none">
          <WebView
            key={searchRequest.id}
            source={{ uri: searchRequest.url }}
            userAgent={CUSTOM_USER_AGENT}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            injectedJavaScript={LINKEDIN_SEARCH_EXTRACTION_SCRIPT}
            onMessage={handleSearchWebViewMessage}
            onError={async () => {
              const reqSnapshot = searchRequest;
              clearBotSearch();
              await recordBotCheckError('WebView search failed to load');
              notifyBotDataUpdated();
              if (reqSnapshot.showAlert) {
                Alert.alert('Search Error', 'Could not load LinkedIn search page.');
              }
            }}
          />
        </View>
      )}

      {/* Hidden WebView 2: Easy Apply Auto-Apply Runner */}
      {activeAutoApplyJob && (
        <View style={styles.hiddenRunner} pointerEvents="none">
          <WebView
            key={activeAutoApplyJob.id}
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
              notifyBotDataUpdated();
            }}
          />
        </View>
      )}
    </>
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
