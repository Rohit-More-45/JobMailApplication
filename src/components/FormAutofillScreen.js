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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildAutofillScript } from '../scripts/formAutofillInjection';

const STORAGE_KEY = '@JobMail:saved_form_fields';

const DEFAULT_SUGGESTIONS = [
  'Full Name',
  'First Name',
  'Last Name',
  'Email Address',
  'Phone Number',
  'Current Address',
  'City',
  'State',
  'Country',
  'PIN Code',
  'LinkedIn Profile',
  'Portfolio URL',
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

  // Add field modal
  const [modalVisible, setModalVisible] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  // Load saved values from AsyncStorage on mount
  useEffect(() => {
    async function loadFields() {
      try {
        const json = await AsyncStorage.getItem(STORAGE_KEY);
        if (json) {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            setSavedFields(parsed);
          }
        }
      } catch (err) {
        console.warn('[FormAutofillScreen] Load storage error:', err);
      } finally {
        setLoadingStorage(false);
      }
    }
    loadFields();
  }, []);

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

  // Handle Add New Field
  const handleSaveNewField = useCallback(async () => {
    const name = newFieldName.trim();
    const value = newFieldValue.trim();

    if (!name || !value) {
      Alert.alert('Missing Info', 'Please enter both field name and value.');
      return;
    }

    const newItem = {
      id: 'field_' + Date.now(),
      name,
      value,
    };

    const updated = [...savedFields, newItem];
    setSavedFields(updated);
    await persistFields(updated);

    setNewFieldName('');
    setNewFieldValue('');
    setModalVisible(false);
  }, [newFieldName, newFieldValue, savedFields, persistFields]);

  // Handle Delete Field (No edit button, only delete per requirements)
  const handleDeleteField = useCallback(
    async (id) => {
      const updated = savedFields.filter((f) => f.id !== id);
      setSavedFields(updated);
      await persistFields(updated);
    },
    [savedFields, persistFields]
  );

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
            <Text style={styles.sectionTitle}>
              Saved Values {savedFields.length > 0 ? `(${savedFields.length})` : ''}
            </Text>

            {/* Plus Icon: Opens Add Field Popup */}
            <TouchableOpacity
              style={styles.addFieldIconBtn}
              onPress={() => setModalVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Add New Field"
            >
              <Ionicons name="add" size={18} color="#ffffff" />
            </TouchableOpacity>
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
            </View>
          ) : (
            <FlatList
              data={savedFields}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={styles.savedItemCard}>
                  <View style={styles.savedItemInfo}>
                    <Text style={styles.savedItemName}>{item.name}</Text>
                    <Text style={styles.savedItemValue} numberOfLines={2}>
                      {item.value}
                    </Text>
                  </View>

                  {/* Small Delete Icon (No edit button per specification) */}
                  <TouchableOpacity
                    style={styles.deleteIconBtn}
                    onPress={() => handleDeleteField(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Delete ${item.name}`}
                  >
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Small Add Field Popup Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Field</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.popupInput}
              placeholder="Field Name (e.g. Full Name)"
              placeholderTextColor="#94a3b8"
              value={newFieldName}
              onChangeText={setNewFieldName}
              autoCapitalize="words"
            />

            {/* Quick Suggestions Chips */}
            <View style={styles.chipsRow}>
              {DEFAULT_SUGGESTIONS.slice(0, 4).map((sugg) => (
                <TouchableOpacity
                  key={sugg}
                  style={styles.chip}
                  onPress={() => setNewFieldName(sugg)}
                >
                  <Text style={styles.chipText}>{sugg}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.popupInput, styles.popupValueInput]}
              placeholder="Field Value (e.g. John Smith)"
              placeholderTextColor="#94a3b8"
              value={newFieldValue}
              onChangeText={setNewFieldValue}
              multiline={false}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveNewField}
              >
                <Text style={styles.modalSaveBtnText}>Save</Text>
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
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
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
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
    fontWeight: '600',
    color: '#0f172a',
  },
  deleteIconBtn: {
    padding: 6,
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
    gap: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
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
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
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
    marginTop: 4,
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
