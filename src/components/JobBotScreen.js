import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelection } from '../context/SelectionContext';
import {
  DEFAULT_BOT_CONFIG,
  loadBotConfig,
  saveBotConfig,
  loadFoundJobs,
  clearFoundJobs,
  loadBotStatus,
  runJobCheckNow,
  resetSeenJobsBaseline,
  syncBackgroundBotRegistration,
  setupJobNotifications,
} from '../services/jobMonitorService';

const TIME_OPTIONS = [
  { label: '5m', value: 'r300' },
  { label: '1h', value: 'r3600' },
  { label: '24h', value: 'r86400' },
  { label: '7d', value: 'r604800' },
];

const WORK_TYPES = [
  { label: 'All', value: '' },
  { label: 'Remote', value: '2' },
  { label: 'Hybrid', value: '3' },
  { label: 'On-site', value: '1' },
];

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export default function JobBotScreen() {
  const insets = useSafeAreaInsets();
  const { navigateToJobUrl } = useSelection();

  const [config, setConfig] = useState(DEFAULT_BOT_CONFIG);
  const [foundJobs, setFoundJobs] = useState([]);
  const [status, setStatus] = useState({
    lastCheckedAt: null,
    lastError: null,
    lastNewCount: 0,
    totalChecks: 0,
  });
  const [checking, setChecking] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refreshUIState = useCallback(async () => {
    const [cfg, jobs, st] = await Promise.all([
      loadBotConfig(),
      loadFoundJobs(),
      loadBotStatus(),
    ]);
    setConfig(cfg);
    setFoundJobs(jobs);
    setStatus(st);
  }, []);

  useEffect(() => {
    refreshUIState();
    const uiTimer = setInterval(refreshUIState, 15000);
    return () => clearInterval(uiTimer);
  }, [refreshUIState]);

  const handleToggleBot = useCallback(
    async (nextEnabled) => {
      if (nextEnabled) {
        const granted = await setupJobNotifications();
        if (!granted) {
          Alert.alert(
            'Notification Permission Needed',
            'Please allow notifications so the bot can alert you when new LinkedIn jobs appear.'
          );
        }
      }

      const updated = await saveBotConfig({ ...config, enabled: nextEnabled });
      setConfig(updated);
      await syncBackgroundBotRegistration(nextEnabled);

      if (nextEnabled) {
        setChecking(true);
        const res = await runJobCheckNow({ notify: false });
        setChecking(false);
        await refreshUIState();
        if (res.status?.lastError) {
          Alert.alert('Check Issue', res.status.lastError);
        }
      }
    },
    [config, refreshUIState]
  );

  const handleSaveCondition = useCallback(async () => {
    if (!config.keywords.trim() && !config.customUrl.trim()) {
      Alert.alert('Missing Search Condition', 'Enter job keywords or a LinkedIn search URL.');
      return;
    }

    await resetSeenJobsBaseline();
    const updated = await saveBotConfig(config);
    setConfig(updated);
    await syncBackgroundBotRegistration(updated.enabled);

    setChecking(true);
    const res = await runJobCheckNow({ notify: true, forceBaselineNotify: false });
    setChecking(false);
    await refreshUIState();

    if (res.status?.lastError) {
      Alert.alert('Search Error', res.status.lastError);
    } else {
      Alert.alert(
        'Condition Saved',
        `Loaded ${res.totalFetched || 0} matching LinkedIn jobs. You will get a notification whenever a new job is posted.`
      );
    }
  }, [config, refreshUIState]);

  const handleCheckNow = useCallback(async () => {
    setChecking(true);
    const res = await runJobCheckNow({ notify: true });
    setChecking(false);
    await refreshUIState();

    if (res.status?.lastError) {
      Alert.alert('Check Failed', res.status.lastError);
    } else if (res.newJobs && res.newJobs.length > 0) {
      Alert.alert('New Jobs Found', `Found ${res.newJobs.length} new matching job(s).`);
    }
  }, [refreshUIState]);

  const handleClearJobs = useCallback(async () => {
    await clearFoundJobs();
    setFoundJobs([]);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 10) }]}>
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={[styles.logoBadge, config.enabled && styles.logoBadgeActive]}>
            <Ionicons name="pulse" size={16} color="#ffffff" />
          </View>
          <View>
            <Text style={styles.brandTitle}>LinkedIn Job Bot</Text>
            <Text style={styles.brandSub}>
              {config.enabled ? 'Active • 5m foreground / background alerts' : 'Paused • No AI'}
            </Text>
          </View>
        </View>

        <Switch
          value={config.enabled}
          onValueChange={handleToggleBot}
          trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
          thumbColor={config.enabled ? '#0a66c2' : '#f8fafc'}
        />
      </View>

      {/* Search Condition Panel */}
      <View style={styles.configCard}>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1.3 }]}
            placeholder="Keywords (e.g. .NET React)"
            placeholderTextColor="#94a3b8"
            value={config.keywords}
            onChangeText={(text) => setConfig((prev) => ({ ...prev, keywords: text }))}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Location (e.g. India)"
            placeholderTextColor="#94a3b8"
            value={config.location}
            onChangeText={(text) => setConfig((prev) => ({ ...prev, location: text }))}
          />
        </View>

        {/* Time & Work Type Chips */}
        <View style={styles.filtersRow}>
          <View style={styles.chipGroup}>
            {TIME_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.chip,
                  config.timeFilter === opt.value && styles.chipActive,
                ]}
                onPress={() => setConfig((prev) => ({ ...prev, timeFilter: opt.value }))}
              >
                <Text
                  style={[
                    styles.chipText,
                    config.timeFilter === opt.value && styles.chipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.chipGroup}>
            {WORK_TYPES.map((wt) => (
              <TouchableOpacity
                key={wt.label}
                style={[
                  styles.chip,
                  config.workType === wt.value && styles.chipActive,
                ]}
                onPress={() => setConfig((prev) => ({ ...prev, workType: wt.value }))}
              >
                <Text
                  style={[
                    styles.chipText,
                    config.workType === wt.value && styles.chipTextActive,
                  ]}
                >
                  {wt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Optional Custom URL Toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced((v) => !v)}
        >
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? 'Hide Custom Search URL' : '+ Optional: Paste LinkedIn Search URL'}
          </Text>
        </TouchableOpacity>

        {showAdvanced && (
          <TextInput
            style={styles.input}
            placeholder="https://www.linkedin.com/jobs/search/?keywords=..."
            placeholderTextColor="#94a3b8"
            value={config.customUrl}
            onChangeText={(text) => setConfig((prev) => ({ ...prev, customUrl: text }))}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSaveCondition}
            disabled={checking}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color="#ffffff" />
            <Text style={styles.saveBtnText}>Save Condition</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkBtn}
            onPress={handleCheckNow}
            disabled={checking}
            activeOpacity={0.85}
          >
            {checking ? (
              <ActivityIndicator size="small" color="#0a66c2" />
            ) : (
              <Ionicons name="refresh" size={16} color="#0a66c2" />
            )}
            <Text style={styles.checkBtnText}>{checking ? 'Checking...' : 'Check Now'}</Text>
          </TouchableOpacity>
        </View>

        {/* Status Bar */}
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>
            Last check: {formatTimeAgo(status.lastCheckedAt)} • Checks: {status.totalChecks || 0}
          </Text>
          {status.lastError ? (
            <Text style={styles.errorStatusText} numberOfLines={1}>
              {status.lastError}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Discovered Jobs Header */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listHeaderTitle}>
          Detected Jobs {foundJobs.length > 0 ? `(${foundJobs.length})` : ''}
        </Text>
        {foundJobs.length > 0 && (
          <TouchableOpacity onPress={handleClearJobs}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Discovered Jobs List */}
      {foundJobs.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="notifications-outline" size={32} color="#cbd5e1" />
          <Text style={styles.emptyText}>
            Set your search condition and tap Check Now or turn the Bot ON.
          </Text>
        </View>
      ) : (
        <FlatList
          data={foundJobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.jobCard}
              onPress={() => navigateToJobUrl(item.url)}
              activeOpacity={0.75}
            >
              <View style={styles.jobCardTop}>
                <Text style={styles.jobTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.isNew && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>NEW</Text>
                  </View>
                )}
              </View>
              <Text style={styles.jobCompany} numberOfLines={1}>
                {item.company}
                {item.location ? ` • ${item.location}` : ''}
              </Text>
              <View style={styles.jobMetaRow}>
                <Text style={styles.jobTime}>{item.timeText}</Text>
                <Text style={styles.openLinkText}>Open in LinkedIn →</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBadgeActive: {
    backgroundColor: '#0a66c2',
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  brandSub: {
    fontSize: 10,
    color: '#64748b',
  },
  configCard: {
    backgroundColor: '#ffffff',
    margin: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 12,
    color: '#0f172a',
  },
  filtersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#0a66c2',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#0a66c2',
  },
  advancedToggle: {
    alignSelf: 'flex-start',
  },
  advancedToggleText: {
    fontSize: 11,
    color: '#0a66c2',
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a66c2',
    paddingVertical: 8,
    borderRadius: 7,
    gap: 5,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  checkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 8,
    borderRadius: 7,
    gap: 5,
  },
  checkBtnText: {
    color: '#0a66c2',
    fontSize: 12,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    color: '#64748b',
  },
  errorStatusText: {
    fontSize: 10,
    color: '#ef4444',
    maxWidth: '50%',
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  listHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  clearText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 16,
    gap: 6,
  },
  jobCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    gap: 3,
  },
  jobCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  jobTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  newBadge: {
    backgroundColor: '#10a37f',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  newBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  jobCompany: {
    fontSize: 12,
    color: '#475569',
  },
  jobMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  jobTime: {
    fontSize: 10,
    color: '#94a3b8',
  },
  openLinkText: {
    fontSize: 11,
    color: '#0a66c2',
    fontWeight: '600',
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
