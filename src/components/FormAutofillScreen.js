import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildAutofillScript } from '../scripts/formAutofillInjection';

const STORAGE_KEY = '@JobMail:saved_form_fields';
const SEED_KEY = '@JobMail:form_fields_seeded_v3';

export const DEFAULT_READY_ANSWERS = [
  { id: 'ans_1', name: 'Full Name', value: 'Rohit More' },
  { id: 'ans_2', name: 'Phone Number', value: '+91-9545496035' },
  { id: 'ans_3', name: 'Email', value: 'rohitmoreofficial45@gmail.com' },
  { id: 'ans_4', name: 'LinkedIn / Profile', value: 'LinkedIn | GeeksforGeeks' },
  { id: 'ans_5', name: 'Current Location', value: 'Nashik, Maharashtra, India' },
  { id: 'ans_6', name: 'Position Applied For', value: 'Software Engineer / Full Stack Developer (.NET / Angular / Azure)' },
  { id: 'ans_7', name: 'Highest Education', value: 'Bachelor of Engineering in Computer Engineering' },
  { id: 'ans_8', name: 'College / University', value: 'MET’s Institute of Engineering, Savitribai Phule Pune University' },
  { id: 'ans_9', name: 'CGPA', value: '8.60 / 10' },
  { id: 'ans_10', name: 'Graduation Year', value: 'May 2024' },
  { id: 'ans_11', name: 'Current Company', value: 'Aress Software and Education Technologies' },
  { id: 'ans_12', name: 'Current Job Title', value: 'Software Engineer' },
  { id: 'ans_13', name: 'Experience Duration', value: 'June 2024 – Present (2+ years)' },
  { id: 'ans_14', name: 'Key Skills', value: 'C#, ASP.NET Core, Angular, React, SQL Server, Microsoft Azure, REST APIs, CI/CD, Entity Framework, JWT' },
  { id: 'ans_15', name: 'Notice Period / Availability', value: '15–30 days' },
  { id: 'ans_16', name: 'Expected Salary', value: 'As per industry standards / Open to discussion' },
  { id: 'ans_17', name: 'Work Authorization', value: 'Yes (authorized to work in India)' },
  { id: 'ans_18', name: 'Willing to Relocate', value: 'Yes (open to discussion)' },
  {
    id: 'ans_19',
    name: 'Professional Summary',
    value:
      'Software Engineer with 2+ years experience building scalable cloud-native applications using ASP.NET Core, Angular, React and Microsoft Azure. Delivered production healthcare solutions, reduced Azure costs by ~20%, and automated CI/CD pipelines.',
  },
];

const DEFAULT_SUGGESTIONS = [
  'Full Name',
  'First Name',
  'Last Name',
  'Phone Number',
  'Email',
  'Current Location',
  'Position Applied For',
  'Highest Education',
  'College / University',
  'CGPA',
  'Graduation Year',
  'Current Company',
  'Current Job Title',
  'Experience Duration',
  'Key Skills',
  'Notice Period / Availability',
  'Expected Salary',
  'Work Authorization',
  'Willing to Relocate',
  'Professional Summary',
];

const CUSTOM_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

export default function FormAutofillScreen() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);

  // Saved values list
  const [savedFields, setSavedFields] = useState([]);
  const [loadingStorage, setLoadingStorage] = useState(true);

  // Form URL browsing state
  const [urlInput, setUrlInput] = useState('');
  const [currentFormUrl, setCurrentFormUrl] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // Add / Edit field modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  const loadFieldsFromStorage = useCallback(async () => {
    try {
      const seeded = await AsyncStorage.getItem(SEED_KEY);
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      let parsed = null;
      if (json) {
        try {
          parsed = JSON.parse(json);
        } catch (_e) {}
      }

      if (!seeded || !Array.isArray(parsed) || parsed.length === 0) {
        setSavedFields(DEFAULT_READY_ANSWERS);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_READY_ANSWERS));
        await AsyncStorage.setItem(SEED_KEY, 'v3');
      } else {
        // Put unanswered bot questions first so user sees them immediately
        const sorted = [...parsed].sort((a, b) => {
          const aEmpty = !a.value || !a.value.toString().trim() || a.needsAnswer ? 0 : 1;
          const bEmpty = !b.value || !b.value.toString().trim() || b.needsAnswer ? 0 : 1;
          return aEmpty - bEmpty;
        });
        setSavedFields(sorted);
      }
    } catch (err) {
      console.warn('[FormAutofillScreen] Load storage error:', err);
      setSavedFields(DEFAULT_READY_ANSWERS);
    } finally {
      setLoadingStorage(false);
    }
  }, []);

  // Load saved values on mount and whenever user switches to Autofill tab
  useEffect(() => {
    loadFieldsFromStorage();
  }, [loadFieldsFromStorage]);

  useFocusEffect(
    useCallback(() => {
      loadFieldsFromStorage();
    }, [loadFieldsFromStorage])
  );

  // Save fields to AsyncStorage
  const persistFields = useCallback(async (fields) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
    } catch (err) {
      console.warn('[FormAutofillScreen] Persist error:', err);
    }
  }, []);

  // Handle hardware back on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (modalVisible) {
        setModalVisible(false);
        setEditingItem(null);
        return true;
      }
      if (currentFormUrl) {
        setCurrentFormUrl(null);
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [modalVisible, currentFormUrl]);

  // Open Add modal
  const handleStartAdd = useCallback(() => {
    setEditingItem(null);
    setNewFieldName('');
    setNewFieldValue('');
    setModalVisible(true);
  }, []);

  // Open Edit modal prefilled with item's data
  const handleStartEdit = useCallback((item) => {
    setEditingItem(item);
    setNewFieldName(item.name);
    setNewFieldValue(item.value);
    setModalVisible(true);
  }, []);

  // Close modal and reset fields
  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
    setEditingItem(null);
    setNewFieldName('');
    setNewFieldValue('');
  }, []);

  // Handle Save (Add or Update)
  const handleSaveField = useCallback(async () => {
    const name = newFieldName.trim();
    const value = newFieldValue.trim();

    if (!name || !value) {
      Alert.alert('Missing Info', 'Please enter both field name and value.');
      return;
    }

    let updated;
    if (editingItem) {
      updated = savedFields.map((f) =>
        f.id === editingItem.id ? { ...f, name, value, needsAnswer: false } : f
      );
    } else {
      const newItem = {
        id: 'field_' + Date.now(),
        name,
        value,
        needsAnswer: false,
      };
      updated = [...savedFields, newItem];
    }

    setSavedFields(updated);
    await persistFields(updated);

    handleCloseModal();
  }, [newFieldName, newFieldValue, editingItem, savedFields, persistFields, handleCloseModal]);

  // Handle Delete Field
  const handleDeleteField = useCallback(
    async (id) => {
      const updated = savedFields.filter((f) => f.id !== id);
      setSavedFields(updated);
      await persistFields(updated);
    },
    [savedFields, persistFields]
  );

  // Restore Default Ready Answers
  const handleResetDefaults = useCallback(() => {
    Alert.alert(
      'Restore Ready Answers',
      'Do you want to reset all saved fields to Rohit More’s default job application ready answers?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setSavedFields(DEFAULT_READY_ANSWERS);
            await persistFields(DEFAULT_READY_ANSWERS);
          },
        },
      ]
    );
  }, [persistFields]);

  // Handle Open Form URL
  const handleOpenFormUrl = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw) {
      Alert.alert('Empty URL', 'Please enter or paste an online form URL.');
      return;
    }

    let url = raw;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    setCurrentFormUrl(url);
    setFormLoading(true);
  }, [urlInput]);

  // Trigger Autofill into WebView
  const triggerAutofill = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(buildAutofillScript(savedFields));
    }
  }, [savedFields]);

  // Handle message from WebView
  const handleWebViewMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'AUTOFILL_RESULT') {
        if (data.count > 0) {
          Alert.alert('Autofill Complete', `Automatically filled ${data.count} matching fields.`);
        }
      }
    } catch (_e) {}
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 8) }]}>
      {/* Mode 1: Active Form WebView View */}
      {currentFormUrl ? (
        <View style={styles.formContainer}>
          {/* Compact Form Navigation Bar */}
          <View style={styles.formNavBar}>
            <TouchableOpacity
              style={styles.formNavIconBtn}
              onPress={() => setCurrentFormUrl(null)}
              accessibilityLabel="Back to Saved Values"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={18} color="#0f172a" />
            </TouchableOpacity>

            <Text style={styles.formUrlText} numberOfLines={1}>
              {currentFormUrl}
            </Text>

            <TouchableOpacity
              style={styles.autofillPillBtn}
              onPress={triggerAutofill}
              accessibilityLabel="Autofill Form"
              activeOpacity={0.8}
            >
              <Ionicons name="flash" size={13} color="#ffffff" />
              <Text style={styles.autofillPillBtnText}>Autofill</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.formNavIconBtn}
              onPress={() => webViewRef.current?.reload()}
              accessibilityLabel="Reload"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="reload" size={16} color="#475569" />
            </TouchableOpacity>
          </View>

          {/* Form WebView */}
          <View style={styles.webViewWrapper}>
            <WebView
              ref={webViewRef}
              source={{ uri: currentFormUrl }}
              style={styles.webView}
              userAgent={CUSTOM_USER_AGENT}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              injectedJavaScript={buildAutofillScript(savedFields)}
              onLoadStart={() => setFormLoading(true)}
              onLoadEnd={() => {
                setFormLoading(false);
                triggerAutofill();
              }}
              onMessage={handleWebViewMessage}
            />
            {formLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color="#0a66c2" />
              </View>
            )}
          </View>
        </View>
      ) : (
        /* Mode 2: Saved Values Manager + Compact URL Input */
        <View style={styles.managerContainer}>
          {/* Compact Top URL Bar */}
          <View style={styles.urlInputRow}>
            <TextInput
              style={styles.urlTextInput}
              placeholder="Paste form URL..."
              placeholderTextColor="#94a3b8"
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleOpenFormUrl}
            />
            <TouchableOpacity
              style={styles.openUrlBtn}
              onPress={handleOpenFormUrl}
              activeOpacity={0.8}
              accessibilityLabel="Open Form"
            >
              <Ionicons name="arrow-forward" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Saved Values Section Header */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWrapper}>
              <Text style={styles.sectionTitle}>Ready Answers</Text>
              {savedFields.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{savedFields.length}</Text>
                </View>
              )}
            </View>

            <View style={styles.sectionHeaderActions}>
              {/* Restore Defaults Button */}
              <TouchableOpacity
                style={styles.resetHeaderBtn}
                onPress={handleResetDefaults}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Restore Defaults"
              >
                <Ionicons name="refresh-outline" size={17} color="#64748b" />
              </TouchableOpacity>

              {/* Plus Icon: Opens Add Field Popup */}
              <TouchableOpacity
                style={styles.addFieldIconBtn}
                onPress={handleStartAdd}
                activeOpacity={0.8}
                accessibilityLabel="Add New Field"
              >
                <Ionicons name="add" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Saved Values List */}
          {loadingStorage ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="small" color="#0a66c2" />
            </View>
          ) : savedFields.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="document-text-outline" size={32} color="#cbd5e1" />
              <Text style={styles.emptyText}>No saved values yet. Tap + to add fields.</Text>
              <TouchableOpacity
                style={styles.emptyRestoreBtn}
                onPress={handleResetDefaults}
                activeOpacity={0.8}
              >
                <Text style={styles.emptyRestoreBtnText}>Load Default Answers</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={savedFields}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isPending = !item.value || !item.value.toString().trim() || item.needsAnswer;
                return (
                  <View
                    style={[
                      styles.savedItemCard,
                      isPending && styles.pendingItemCard,
                    ]}
                  >
                    <View style={styles.savedItemInfo}>
                      <View style={styles.savedItemHeaderRow}>
                        <Text style={styles.savedItemName}>{item.name}</Text>
                        {isPending && (
                          <View style={styles.needsAnswerBadge}>
                            <Text style={styles.needsAnswerBadgeText}>NEEDS ANSWER</Text>
                          </View>
                        )}
                      </View>
                      {isPending ? (
                        <Text style={styles.pendingValueHint}>
                          {Array.isArray(item.options) && item.options.length > 0
                            ? `Options: ${item.options.join(' / ')} — Tap pencil to answer`
                            : 'Tap pencil icon to add your answer for future Easy Apply jobs'}
                        </Text>
                      ) : (
                        <Text style={styles.savedItemValue} numberOfLines={3}>
                          {item.value}
                        </Text>
                      )}
                    </View>

                    {/* Actions: Edit and Delete buttons */}
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity
                        style={styles.cardActionBtn}
                        onPress={() => handleStartEdit(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Edit ${item.name}`}
                      >
                        <Ionicons name="pencil-outline" size={16} color="#0a66c2" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.cardActionBtn}
                        onPress={() => handleDeleteField(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Delete ${item.name}`}
                      >
                        <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Add / Edit Field Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingItem ? 'Edit Field' : 'Add Field'}
              </Text>
              <TouchableOpacity
                onPress={handleCloseModal}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalFieldLabel}>Field Name</Text>
            <TextInput
              style={styles.popupInput}
              placeholder="e.g. Current Job Title"
              placeholderTextColor="#94a3b8"
              value={newFieldName}
              onChangeText={setNewFieldName}
              autoCapitalize="words"
            />

            {/* Quick Suggestions Chips (shown when adding) */}
            {!editingItem && (
              <View style={styles.chipsRow}>
                {DEFAULT_SUGGESTIONS.slice(0, 6).map((sugg) => (
                  <TouchableOpacity
                    key={sugg}
                    style={styles.chip}
                    onPress={() => setNewFieldName(sugg)}
                  >
                    <Text style={styles.chipText}>{sugg}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.modalFieldLabel}>Field Value</Text>
            <TextInput
              style={[styles.popupInput, styles.popupValueInput]}
              placeholder="e.g. Software Engineer"
              placeholderTextColor="#94a3b8"
              value={newFieldValue}
              onChangeText={setNewFieldValue}
              multiline={true}
              numberOfLines={3}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={handleCloseModal}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveField}
              >
                <Text style={styles.modalSaveBtnText}>
                  {editingItem ? 'Update' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  managerContainer: {
    flex: 1,
    paddingHorizontal: 12,
  },
  urlInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  urlTextInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    color: '#0f172a',
  },
  openUrlBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#0a66c2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sectionTitleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  countBadge: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resetHeaderBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFieldIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0a66c2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingVertical: 6,
    gap: 6,
  },
  savedItemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pendingItemCard: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  savedItemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  needsAnswerBadge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  needsAnswerBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  pendingValueHint: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#b45309',
  },
  savedItemInfo: {
    flex: 1,
    paddingRight: 8,
  },
  savedItemName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  savedItemValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0f172a',
    lineHeight: 18,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  cardActionBtn: {
    padding: 6,
    borderRadius: 4,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 40,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyRestoreBtn: {
    marginTop: 6,
    backgroundColor: '#0a66c2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  emptyRestoreBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Form WebView Mode Styles
  formContainer: {
    flex: 1,
  },
  formNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  formNavIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  formUrlText: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
  },
  autofillPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10a37f',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  autofillPillBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  webViewWrapper: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 6,
    right: 8,
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  popupInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  popupValueInput: {
    minHeight: 70,
    maxHeight: 140,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
    marginBottom: 4,
  },
  chip: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 10,
    color: '#0a66c2',
    fontWeight: '600',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  modalCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#0a66c2',
  },
  modalSaveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
});
