import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  FlatList,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelection } from '../context/SelectionContext';
import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  DEFAULT_BOT_CONFIG,
  buildLinkedInBrowserSearchUrl,
  loadBotConfig,
  saveBotConfig,
  loadFoundJobs,
  clearFoundJobs,
  loadAppliedJobs,
  loadManualJobs,
  addJobToAppliedList,
  clearAppliedJobsList,
  clearManualJobsList,
  loadBotStatus,
  resetSeenJobsBaseline,
  syncBackgroundBotRegistration,
  setupJobNotifications,
} from '../services/jobMonitorService';

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
  const {
    navigateToJobUrl,
    activeAutoApplyJob,
    easyApplyQueue,
    isSearchingBot,
    botDataVersion,
    triggerBotSearch,
  } = useSelection();

  const [config, setConfig] = useState(DEFAULT_BOT_CONFIG);
  const [foundJobs, setFoundJobs] = useState([]);
  const [appliedJobs, setAppliedJobs] = useState([]);
  const [manualJobs, setManualJobs] = useState([]);
  const [status, setStatus] = useState({
    lastCheckedAt: null,
    lastError: null,
    lastNewCount: 0,
    totalChecks: 0,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Two-list popup modal state
  const [listsModalVisible, setListsModalVisible] = useState(false);
  const [activeListTab, setActiveListTab] = useState('applied'); // 'applied' | 'manual'

  const refreshUIState = useCallback(async () => {
    const [cfg, jobs, applied, manual, st] = await Promise.all([
      loadBotConfig(),
      loadFoundJobs(),
      loadAppliedJobs(),
      loadManualJobs(),
      loadBotStatus(),
    ]);
    setConfig(cfg);
    setFoundJobs(jobs);
    setAppliedJobs(applied);
    setManualJobs(manual);
    setStatus(st);
  }, []);

  useEffect(() => {
    refreshUIState();
  }, [refreshUIState, botDataVersion]);

  useEffect(() => {
    const uiTimer = setInterval(refreshUIState, 10000);
    return () => clearInterval(uiTimer);
  }, [refreshUIState]);

  const toggleExperienceLevel = useCallback((val) => {
    setConfig((prev) => {
      const current = Array.isArray(prev.experienceLevels) ? prev.experienceLevels : [];
      const exists = current.includes(val);
      const next = exists ? current.filter((v) => v !== val) : [...current, val];
      return { ...prev, experienceLevels: next };
    });
  }, []);

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
        const searchUrl = buildLinkedInBrowserSearchUrl(updated);
        triggerBotSearch(searchUrl, { notify: false, showAlert: false });
      }
    },
    [config, triggerBotSearch]
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

    const searchUrl = buildLinkedInBrowserSearchUrl(updated);
    triggerBotSearch(searchUrl, { notify: true, showAlert: true });
  }, [config, triggerBotSearch]);

  const handleCheckNow = useCallback(async () => {
    if (!config.keywords.trim() && !config.customUrl.trim()) {
      Alert.alert('Missing Search Condition', 'Enter job keywords or a LinkedIn search URL.');
      return;
    }
    const updated = await saveBotConfig(config);
    setConfig(updated);
    const searchUrl = buildLinkedInBrowserSearchUrl(updated);
    triggerBotSearch(searchUrl, { notify: true, showAlert: true });
  }, [config, triggerBotSearch]);

  const handleOpenSearchInLinkedIn = useCallback(async () => {
    const updated = await saveBotConfig(config);
    const searchUrl = buildLinkedInBrowserSearchUrl(updated);
    navigateToJobUrl(searchUrl);
  }, [config, navigateToJobUrl]);

  const handleMarkManualAsApplied = useCallback(
    async (job) => {
      await addJobToAppliedList(job, 'Marked applied manually');
      await refreshUIState();
    },
    [refreshUIState]
  );

  const handleClearActiveModalList = useCallback(async () => {
    if (activeListTab === 'applied') {
      await clearAppliedJobsList();
    } else {
      await clearManualJobsList();
    }
    await refreshUIState();
  }, [activeListTab, refreshUIState]);

  const modalData = activeListTab === 'applied' ? appliedJobs : manualJobs;

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
              {config.enabled ? 'Active • 5m auto-refresh (No AI)' : 'Paused • No AI'}
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

      {/* Application Lists Popup Trigger Button */}
      <View style={styles.listsBannerRow}>
        <TouchableOpacity
          style={styles.openListsBtn}
          onPress={() => setListsModalVisible(true)}
          activeOpacity={0.85}
        >
          <View style={styles.openListsLeft}>
            <Ionicons name="layers-outline" size={17} color="#ffffff" />
            <Text style={styles.openListsTitle}>Applied & Manual Lists</Text>
          </View>
          <View style={styles.countsPillGroup}>
            <View style={styles.appliedPill}>
              <Text style={styles.appliedPillText}>Applied: {appliedJobs.length}</Text>
            </View>
            <View style={styles.manualPill}>
              <Text style={styles.manualPillText}>Manual: {manualJobs.length}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Live Auto-Apply Runner Banner */}
      {(activeAutoApplyJob || easyApplyQueue.length > 0) && (
        <View style={styles.autoApplyBanner}>
          <ActivityIndicator size="small" color="#0a66c2" />
          <Text style={styles.autoApplyBannerText} numberOfLines={1}>
            Auto-Applying: {activeAutoApplyJob?.title || 'Queued'} ({easyApplyQueue.length} left)
          </Text>
        </View>
      )}

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* Search & Must-Have Filters Card */}
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

          {/* Filter 1: Date Posted (MUST) */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Date Posted</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipGroup}>
                {DATE_POSTED_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.label}
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
            </ScrollView>
          </View>

          {/* Filter 2: Experience Level (Exact LinkedIn options) */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Experience Level</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipGroup}>
                <TouchableOpacity
                  style={[
                    styles.chip,
                    (!config.experienceLevels || config.experienceLevels.length === 0) &&
                      styles.chipActive,
                  ]}
                  onPress={() => setConfig((prev) => ({ ...prev, experienceLevels: [] }))}
                >
                  <Text
                    style={[
                      styles.chipText,
                      (!config.experienceLevels || config.experienceLevels.length === 0) &&
                        styles.chipTextActive,
                    ]}
                  >
                    Any
                  </Text>
                </TouchableOpacity>

                {EXPERIENCE_LEVEL_OPTIONS.map((exp) => {
                  const selected =
                    Array.isArray(config.experienceLevels) &&
                    config.experienceLevels.includes(exp.value);
                  return (
                    <TouchableOpacity
                      key={exp.value}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => toggleExperienceLevel(exp.value)}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {exp.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Filter 3: Work Mode */}
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Work Mode</Text>
            <View style={styles.chipGroup}>
              {WORK_TYPES.map((wt) => (
                <TouchableOpacity
                  key={wt.label}
                  style={[styles.chip, config.workType === wt.value && styles.chipActive]}
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

          {/* Auto-Apply Easy Apply Toggle */}
          <View style={styles.autoApplySwitchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoApplySwitchTitle}>Auto-Apply Easy Apply Jobs</Text>
              <Text style={styles.autoApplySwitchSub}>
                Uses your LinkedIn tab session to submit Easy Apply & lists others in Manual
              </Text>
            </View>
            <Switch
              value={config.autoApplyEasyApply}
              onValueChange={(val) =>
                setConfig((prev) => ({ ...prev, autoApplyEasyApply: val }))
              }
              trackColor={{ false: '#cbd5e1', true: '#86efac' }}
              thumbColor={config.autoApplyEasyApply ? '#10a37f' : '#f8fafc'}
            />
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
              disabled={isSearchingBot}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle-outline" size={16} color="#ffffff" />
              <Text style={styles.saveBtnText}>Save & Scan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.checkBtn}
              onPress={handleCheckNow}
              disabled={isSearchingBot}
              activeOpacity={0.85}
            >
              {isSearchingBot ? (
                <ActivityIndicator size="small" color="#0a66c2" />
              ) : (
                <Ionicons name="refresh" size={16} color="#0a66c2" />
              )}
              <Text style={styles.checkBtnText}>
                {isSearchingBot ? 'Scanning...' : 'Check Now'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.openBrowserSearchBtn}
              onPress={handleOpenSearchInLinkedIn}
              activeOpacity={0.85}
              accessibilityLabel="Open Search in LinkedIn Tab"
            >
              <Ionicons name="open-outline" size={17} color="#0a66c2" />
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

        {/* Recent Feed Header */}
        <View style={styles.listHeaderRow}>
          <Text style={styles.listHeaderTitle}>
            Latest Scanned Jobs {foundJobs.length > 0 ? `(${foundJobs.length})` : ''}
          </Text>
          {foundJobs.length > 0 && (
            <TouchableOpacity
              onPress={async () => {
                await clearFoundJobs();
                setFoundJobs([]);
              }}
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {foundJobs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-outline" size={28} color="#cbd5e1" />
            <Text style={styles.emptyText}>
              Set Date Posted & Experience Level, then tap Save & Scan.
            </Text>
          </View>
        ) : (
          foundJobs.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.jobCard}
              onPress={() => navigateToJobUrl(item.url)}
              activeOpacity={0.75}
            >
              <View style={styles.jobCardTop}>
                <Text style={styles.jobTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.badgesRow}>
                  {item.isEasyApply ? (
                    <View style={styles.easyBadge}>
                      <Text style={styles.easyBadgeText}>EASY APPLY</Text>
                    </View>
                  ) : (
                    <View style={styles.manualTagBadge}>
                      <Text style={styles.manualTagBadgeText}>MANUAL</Text>
                    </View>
                  )}
                  {item.isNew && (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  )}
                </View>
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
          ))
        )}
      </ScrollView>

      {/* User-Friendly Two-List Popup Modal */}
      <Modal
        visible={listsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setListsModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bot Job Lists</Text>
              <View style={styles.modalHeaderRight}>
                {modalData.length > 0 && (
                  <TouchableOpacity
                    style={styles.modalClearBtn}
                    onPress={handleClearActiveModalList}
                  >
                    <Text style={styles.modalClearBtnText}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setListsModalVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color="#475569" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Two Segmented Tabs: Bot Applied vs Manual Apply */}
            <View style={styles.segmentContainer}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  activeListTab === 'applied' && styles.segmentBtnAppliedActive,
                ]}
                onPress={() => setActiveListTab('applied')}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color={activeListTab === 'applied' ? '#ffffff' : '#10a37f'}
                />
                <Text
                  style={[
                    styles.segmentText,
                    activeListTab === 'applied' && styles.segmentTextActive,
                  ]}
                >
                  Bot Applied ({appliedJobs.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  activeListTab === 'manual' && styles.segmentBtnManualActive,
                ]}
                onPress={() => setActiveListTab('manual')}
              >
                <Ionicons
                  name="hand-left-outline"
                  size={15}
                  color={activeListTab === 'manual' ? '#ffffff' : '#d97706'}
                />
                <Text
                  style={[
                    styles.segmentText,
                    activeListTab === 'manual' && styles.segmentTextActive,
                  ]}
                >
                  Manual Apply ({manualJobs.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* List Body */}
            {modalData.length === 0 ? (
              <View style={styles.modalEmptyBox}>
                <Ionicons
                  name={activeListTab === 'applied' ? 'checkmark-done-outline' : 'briefcase-outline'}
                  size={36}
                  color="#cbd5e1"
                />
                <Text style={styles.modalEmptyTitle}>
                  {activeListTab === 'applied'
                    ? 'No Bot-Applied Jobs Yet'
                    : 'No Manual Jobs Pending'}
                </Text>
                <Text style={styles.modalEmptySub}>
                  {activeListTab === 'applied'
                    ? 'Make sure you are signed in to the LinkedIn tab so the bot can submit Easy Apply jobs automatically.'
                    : 'Non-Easy Apply jobs found by the bot will appear here for you to apply manually.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={modalData}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.modalListContent}
                renderItem={({ item }) => (
                  <View style={styles.modalJobCard}>
                    <View style={styles.modalJobHeader}>
                      <Text style={styles.modalJobTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View
                        style={
                          activeListTab === 'applied'
                            ? styles.statusAppliedBadge
                            : styles.statusManualBadge
                        }
                      >
                        <Text
                          style={
                            activeListTab === 'applied'
                              ? styles.statusAppliedText
                              : styles.statusManualText
                          }
                        >
                          {activeListTab === 'applied' ? 'Applied' : 'Manual'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.modalJobCompany} numberOfLines={1}>
                      {item.company}
                      {item.location ? ` • ${item.location}` : ''}
                    </Text>

                    {item.statusNote ? (
                      <Text style={styles.modalJobNote}>{item.statusNote}</Text>
                    ) : null}

                    <View style={styles.modalJobActions}>
                      <TouchableOpacity
                        style={styles.modalOpenBtn}
                        onPress={() => {
                          setListsModalVisible(false);
                          navigateToJobUrl(item.url);
                        }}
                      >
                        <Text style={styles.modalOpenBtnText}>
                          {activeListTab === 'applied' ? 'View Job' : 'Apply Manually →'}
                        </Text>
                      </TouchableOpacity>

                      {activeListTab === 'manual' && (
                        <TouchableOpacity
                          style={styles.markAppliedBtn}
                          onPress={() => handleMarkManualAsApplied(item)}
                        >
                          <Ionicons name="checkmark" size={14} color="#10a37f" />
                          <Text style={styles.markAppliedBtnText}>Mark Applied</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
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
  listsBannerRow: {
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  openListsBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
  },
  openListsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  openListsTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  countsPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  appliedPill: {
    backgroundColor: '#10a37f',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  appliedPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  manualPill: {
    backgroundColor: '#d97706',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  autoApplyBanner: {
    marginHorizontal: 10,
    marginTop: 6,
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoApplyBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#1e40af',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
    paddingBottom: 20,
    gap: 8,
  },
  configCard: {
    backgroundColor: '#ffffff',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 9,
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
  filterSection: {
    gap: 4,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipGroup: {
    flexDirection: 'row',
    gap: 5,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
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
  autoApplySwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  autoApplySwitchTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  autoApplySwitchSub: {
    fontSize: 10,
    color: '#15803d',
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
    paddingVertical: 9,
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
    paddingVertical: 9,
    borderRadius: 7,
    gap: 5,
  },
  checkBtnText: {
    color: '#0a66c2',
    fontSize: 12,
    fontWeight: '700',
  },
  openBrowserSearchBtn: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 7,
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
    paddingHorizontal: 2,
    marginTop: 2,
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
  badgesRow: {
    flexDirection: 'row',
    gap: 4,
  },
  easyBadge: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  easyBadgeText: {
    color: '#047857',
    fontSize: 9,
    fontWeight: '800',
  },
  manualTagBadge: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  manualTagBadgeText: {
    color: '#b45309',
    fontSize: 9,
    fontWeight: '800',
  },
  newBadge: {
    backgroundColor: '#0a66c2',
    paddingHorizontal: 5,
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },

  // Two-List Popup Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '82%',
    padding: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalClearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#fef2f2',
  },
  modalClearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
  },
  segmentContainer: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 10,
    backgroundColor: '#f1f5f9',
    padding: 4,
    borderRadius: 10,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 5,
  },
  segmentBtnAppliedActive: {
    backgroundColor: '#10a37f',
  },
  segmentBtnManualActive: {
    backgroundColor: '#d97706',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  modalEmptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  modalEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  modalEmptySub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 17,
  },
  modalListContent: {
    paddingBottom: 20,
    gap: 8,
  },
  modalJobCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 11,
    gap: 4,
  },
  modalJobHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalJobTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusAppliedBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusAppliedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065f46',
  },
  statusManualBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusManualText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  modalJobCompany: {
    fontSize: 12,
    color: '#475569',
  },
  modalJobNote: {
    fontSize: 10,
    color: '#64748b',
    fontStyle: 'italic',
  },
  modalJobActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  modalOpenBtn: {
    backgroundColor: '#0a66c2',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
  },
  modalOpenBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  markAppliedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  markAppliedBtnText: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '700',
  },
});
