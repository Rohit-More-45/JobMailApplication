import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  Modal,
  TextInput,
  Linking,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { CHATGPT_INJECTION_SCRIPT } from '../scripts/chatgptInjection';

const CHATGPT_URL = 'https://chatgpt.com';

const REQUIRED_PROMPT_TEMPLATE = `Analyze the job post screenshots and write an email application using this exact format:

MAIL ADDRESS: recipient@example.com
SUBJECT: Email subject here
MAIL:
Complete email body here.`;

const CHATGPT_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

// Parses text in the required three-field format
function parseEmailDetails(text) {
  if (!text) return null;

  // Clean code fence blocks, bold, and italic markers
  const cleaned = text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '');

  // 1. Recipient Address: MAIL ADDRESS: ...
  const addrMatch = cleaned.match(/(?:^|\n)\s*MAIL\s*ADD?RESS\s*:\s*([^\r\n]+)/i);
  const rawAddress = addrMatch ? addrMatch[1].trim() : '';

  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const emailInAddr = rawAddress.match(emailRegex);
  const validEmail = emailInAddr ? emailInAddr[1] : '';

  // 2. Subject: SUBJECT: ...
  const subjMatch = cleaned.match(/(?:^|\n)\s*SUBJECT\s*:\s*([^\r\n]+)/i);
  const subject = subjMatch ? subjMatch[1].trim() : '';

  // 3. Body: MAIL: ... (everything after MAIL:)
  const bodyMatch = cleaned.match(/(?:^|\n)\s*MAIL\s*:\s*([\s\S]*)$/i);
  let body = bodyMatch ? bodyMatch[1].trim() : '';

  if (body) {
    // Strip accidental repeated header labels from inside body
    body = body.replace(/(?:^|\n)\s*MAIL\s*ADD?RESS\s*:\s*[^\r\n]+/gi, '');
    body = body.replace(/(?:^|\n)\s*SUBJECT\s*:\s*[^\r\n]+/gi, '');

    // Strip trailing conversational sign-offs or assistant notes
    const cutoffs = [
      /(?:\r?\n)\s*[-*_]{3,}\s*(?:\r?\n[\s\S]*)?$/i,
      /(?:\r?\n)\s*(?:note|ps|p\.s\.)\s*:\s*[\s\S]*$/i,
      /(?:\r?\n)\s*(?:let me know if|hope this helps|feel free to|good luck with)[\s\S]*$/i,
      /(?:\r?\n)\s*(?:make sure to attach|remember to attach|don't forget to attach)[\s\S]*$/i,
    ];
    for (const c of cutoffs) {
      body = body.replace(c, '');
    }
    body = body.trim();
  }

  return {
    rawAddress,
    validEmail,
    subject,
    body,
  };
}

export default function ChatGPTBrowser() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);

  // Popup Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  // Hardware back button on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (modalVisible) {
        setModalVisible(false);
        return true;
      }
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack, modalVisible]);

  // Handle Paste from Clipboard into the popup
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim().length > 0) {
        setPastedText(text);
      } else {
        Alert.alert('Clipboard Empty', 'Your clipboard is currently empty. Please copy the ChatGPT response first.');
      }
    } catch (err) {
      console.warn('[ChatGPTBrowser] Clipboard error:', err);
    }
  }, []);

  // Handle Copy Prompt Format
  const handleCopyPromptFormat = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(REQUIRED_PROMPT_TEMPLATE);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
      Alert.alert(
        'Format Copied!',
        'The required ChatGPT response format has been copied. Paste it into ChatGPT when asking for an email reply.',
        [{ text: 'OK' }]
      );
    } catch (err) {
      console.warn('[ChatGPTBrowser] Clipboard error:', err);
    }
  }, []);

  // Handle Submit in the popup: Parse 3 fields and Open Gmail
  const handleSubmit = useCallback(async () => {
    const trimmed = pastedText.trim();
    if (!trimmed) {
      Alert.alert(
        'Empty Input',
        'Please paste the complete ChatGPT response into the text area before submitting.',
        [{ text: 'OK' }]
      );
      return;
    }

    const parsed = parseEmailDetails(trimmed);
    const missing = [];

    if (!parsed || !parsed.validEmail) {
      missing.push(
        '• Recipient Email Address (MAIL ADDRESS: ...)\n  ' +
          (parsed && parsed.rawAddress
            ? `"${parsed.rawAddress}" is not a valid email address.`
            : 'No valid recipient email address was detected.')
      );
    }

    if (!parsed || !parsed.subject) {
      missing.push('• Subject Line (SUBJECT: ...)\n  No subject line was detected.');
    }

    if (!parsed || !parsed.body) {
      missing.push('• Email Body (MAIL: ...)\n  No email body content was detected.');
    }

    // Validation: If any required information is missing, show a clear error
    if (missing.length > 0) {
      Alert.alert(
        'Missing or Invalid Information',
        'JobMail requires all three fields to generate your Gmail draft:\n\n' +
          missing.join('\n\n') +
          '\n\nPlease make sure the ChatGPT response contains:\nMAIL ADDRESS: recipient@example.com\nSUBJECT: Email subject\nMAIL:\nEmail body',
        [{ text: 'OK' }]
      );
      return;
    }

    // All 3 fields are valid: Open Gmail compose screen
    const mailtoUrl = `mailto:${encodeURIComponent(parsed.validEmail)}?subject=${encodeURIComponent(
      parsed.subject
    )}&body=${encodeURIComponent(parsed.body)}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (!canOpen) {
        console.warn('[ChatGPTBrowser] canOpenURL returned false for mailto');
      }
      await Linking.openURL(mailtoUrl);
      setModalVisible(false);
      setPastedText('');
    } catch (err) {
      console.warn('[ChatGPTBrowser] Error opening email intent:', err);
      Alert.alert(
        'Could Not Open Email App',
        'Unable to open an email application automatically. Please ensure an email app (such as Gmail) is installed and configured on your device.',
        [{ text: 'OK' }]
      );
    }
  }, [pastedText]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(CHATGPT_INJECTION_SCRIPT);
      } catch (_e) {}
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="chatbubble-ellipses" size={16} color="#ffffff" />
          </View>
          <Text style={styles.brandTitle}>ChatGPT</Text>
        </View>

        <View style={styles.actionsRow}>
          {canGoBack && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => webViewRef.current?.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={20} color="#334155" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => webViewRef.current?.reload()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Reload ChatGPT"
          >
            <Ionicons name={loading ? 'sync' : 'reload'} size={18} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Bar: Prominent "Generate Gmail Draft" Button */}
      <View style={styles.topActionBar}>
        <TouchableOpacity
          style={styles.generateDraftBtn}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="mail-outline" size={18} color="#ffffff" />
          <Text style={styles.generateDraftBtnText}>Generate Gmail Draft</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.promptFormatBtn}
          onPress={handleCopyPromptFormat}
          activeOpacity={0.8}
        >
          <Ionicons
            name={promptCopied ? 'checkmark' : 'copy-outline'}
            size={13}
            color="#0284c7"
          />
          <Text style={styles.promptFormatBtnText}>
            {promptCopied ? 'Copied Format' : 'Prompt Format'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main ChatGPT WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: CHATGPT_URL }}
          style={styles.webView}
          userAgent={CHATGPT_USER_AGENT}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#10a37f" />
              <Text style={styles.loadingText}>Loading ChatGPT...</Text>
            </View>
          )}
          injectedJavaScript={CHATGPT_INJECTION_SCRIPT}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
        />
      </View>

      {/* Simple Popup: Generate Gmail Draft Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleGroup}>
                <View style={styles.mailBadge}>
                  <Ionicons name="mail" size={16} color="#ffffff" />
                </View>
                <Text style={styles.modalTitle}>Generate Gmail Draft</Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close"
              >
                <Ionicons name="close-circle" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalSubtitle}>
                Paste the response generated by ChatGPT below:
              </Text>

              {/* Paste from Clipboard Helper */}
              <View style={styles.helperRow}>
                <TouchableOpacity
                  style={styles.pasteClipboardBtn}
                  onPress={handlePasteFromClipboard}
                  activeOpacity={0.8}
                >
                  <Ionicons name="clipboard-outline" size={14} color="#0a66c2" />
                  <Text style={styles.pasteClipboardBtnText}>Paste from Clipboard</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.clearInputBtn}
                  onPress={() => setPastedText('')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.clearInputBtnText}>Clear Input</Text>
                </TouchableOpacity>
              </View>

              {/* Large Multiline Text Input */}
              <TextInput
                style={styles.largeTextInput}
                multiline={true}
                numberOfLines={10}
                textAlignVertical="top"
                placeholder={
                  'MAIL ADDRESS: recipient@example.com\n' +
                  'SUBJECT: Application for Developer Position\n' +
                  'MAIL:\n' +
                  'Hello,\n' +
                  'I am writing to express my interest in this position...'
                }
                placeholderTextColor="#94a3b8"
                value={pastedText}
                onChangeText={setPastedText}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.formatInfoBox}>
                <Text style={styles.formatInfoTitle}>Expected Response Format:</Text>
                <Text style={styles.formatInfoLine}>MAIL ADDRESS: recipient@example.com</Text>
                <Text style={styles.formatInfoLine}>SUBJECT: Email subject</Text>
                <Text style={styles.formatInfoLine}>MAIL: Complete email body</Text>
              </View>
            </ScrollView>

            {/* Action Buttons: Submit & Cancel */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setModalVisible(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSubmit}
                activeOpacity={0.85}
              >
                <Ionicons name="paper-plane" size={16} color="#ffffff" />
                <Text style={styles.submitBtnText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
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
    backgroundColor: '#10a37f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  topActionBar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  generateDraftBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ea4335',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 8,
    elevation: 2,
  },
  generateDraftBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  promptFormatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bae6fd',
    gap: 5,
  },
  promptFormatBtnText: {
    color: '#0284c7',
    fontSize: 12,
    fontWeight: '600',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    maxHeight: '90%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mailBadge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#ea4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalScrollContent: {
    paddingVertical: 12,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 10,
    lineHeight: 18,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pasteClipboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    gap: 5,
  },
  pasteClipboardBtnText: {
    color: '#0a66c2',
    fontSize: 12,
    fontWeight: '600',
  },
  clearInputBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearInputBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  largeTextInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    padding: 12,
    fontSize: 13,
    color: '#0f172a',
    height: 200,
    lineHeight: 18,
  },
  formatInfoBox: {
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#0a66c2',
  },
  formatInfoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  formatInfoLine: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ea4335',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    elevation: 2,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
