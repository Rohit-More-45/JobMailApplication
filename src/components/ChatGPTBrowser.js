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
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useSelection } from '../context/SelectionContext';
import { CHATGPT_INJECTION_SCRIPT } from '../scripts/chatgptInjection';

const CHATGPT_URL = 'https://chatgpt.com';

const CHATGPT_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

/**
 * Cleans unwanted backslash escape sequences introduced during clipboard copying,
 * JSON serialization, or markdown formatting without removing legitimate characters.
 */
function cleanPastedText(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // 1. If text is wrapped in JSON serialization quotes, unwrap it
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === 'string') {
        cleaned = parsed;
      }
    } catch (_e) {
      cleaned = cleaned.replace(/^["']|["']$/g, '');
    }
  }

  // 2. Normalize literal escaped newlines and tabs (\r\n, \n, \r, \t) to actual whitespace
  cleaned = cleaned.replace(/\\r\\n/g, '\n');
  cleaned = cleaned.replace(/\\n/g, '\n');
  cleaned = cleaned.replace(/\\r/g, '\n');
  cleaned = cleaned.replace(/\\t/g, '\t');

  // 3. Remove escaped quotes: \" -> " and \' -> '
  cleaned = cleaned.replace(/\\(["'])/g, '$1');

  // 4. Remove unwanted markdown / punctuation escape backslashes:
  // ChatGPT or markdown copiers often insert \ before punctuation:
  // e.g. \: -> :, \[ -> [, \] -> ], \( -> (, \) -> ), \_ -> _, \* -> *, \- -> -, \. -> ., \! -> !
  cleaned = cleaned.replace(/\\([:\[\]\(\)\*\_~`#>+=\-|{}.!@])/g, '$1');

  // 5. Remove standalone dangling backslashes at the end of lines or before spaces
  cleaned = cleaned.replace(/\\+(?=\s|$)/g, '');

  // 6. Collapse duplicate backslashes if any were doubled by escaping
  cleaned = cleaned.replace(/\\\\/g, '\\');

  return cleaned;
}

// Parses text in the required three-field format
function parseEmailDetails(text) {
  if (!text) return null;

  const preCleaned = cleanPastedText(text);

  // Clean code fence blocks, bold, and italic markers
  const cleaned = preCleaned
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
  const { screenshots } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);

  // Popup Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [pastedText, setPastedText] = useState('');

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

  // Handle Paste from Clipboard into the popup with automatic backslash cleaning
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim().length > 0) {
        const cleaned = cleanPastedText(text);
        setPastedText(cleaned);
      } else {
        Alert.alert('Clipboard Empty', 'Your clipboard is currently empty.');
      }
    } catch (err) {
      console.warn('[ChatGPTBrowser] Clipboard error:', err);
    }
  }, []);

  // Handle Submit in the popup: Parse 3 fields and Open Gmail
  const handleSubmit = useCallback(async () => {
    const trimmed = cleanPastedText(pastedText).trim();
    if (!trimmed) {
      Alert.alert(
        'Empty Input',
        'Please paste the ChatGPT response before submitting.',
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
            : 'No valid recipient email address found.')
      );
    }

    if (!parsed || !parsed.subject) {
      missing.push('• Subject Line (SUBJECT: ...)\n  No subject line found.');
    }

    if (!parsed || !parsed.body) {
      missing.push('• Email Body (MAIL: ...)\n  No email body content found.');
    }

    // Validation: If any required information is missing, show error
    if (missing.length > 0) {
      Alert.alert(
        'Missing Information',
        'Please ensure the text contains all three fields:\n\n' +
          missing.join('\n\n'),
        [{ text: 'OK' }]
      );
      return;
    }

    // All 3 fields valid: Open Gmail compose screen
    const mailtoUrl = `mailto:${encodeURIComponent(parsed.validEmail)}?subject=${encodeURIComponent(
      parsed.subject
    )}&body=${encodeURIComponent(parsed.body)}`;

    try {
      await Linking.openURL(mailtoUrl);
      setModalVisible(false);
      setPastedText('');
    } catch (err) {
      console.warn('[ChatGPTBrowser] Error opening email intent:', err);
      Alert.alert(
        'Could Not Open Email App',
        'Unable to open an email application automatically. Please ensure an email app like Gmail is installed.',
        [{ text: 'OK' }]
      );
    }
  }, [pastedText]);

  const triggerSharingFallback = useCallback(async (uris) => {
    if (!uris || uris.length === 0) return;
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      Alert.alert(
        'Attach Screenshots',
        'Direct web insertion was not accepted by the ChatGPT page. Screenshot has been copied to your clipboard.\n\nWould you like to attach it via Android file sharing?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Attach via Share',
            onPress: async () => {
              if (isAvailable && uris[0]) {
                try {
                  await Sharing.shareAsync(uris[0], {
                    mimeType: 'image/png',
                    dialogTitle: 'Attach Screenshot to ChatGPT',
                  });
                } catch (err) {
                  console.warn('[ChatGPTBrowser] Sharing error:', err);
                }
              }
            },
          },
        ]
      );
    } catch (_err) {
      Alert.alert(
        'Screenshot on Clipboard',
        'Direct insertion was not accepted. The screenshot has been copied to your clipboard so you can paste it into the composer.',
        [{ text: 'OK' }]
      );
    }
  }, []);

  const handlePasteScreenshots = useCallback(async () => {
    if (!screenshots || screenshots.length === 0) {
      Alert.alert(
        'No Screenshots Available',
        'No screenshots have been captured yet. Open the browser tab and tap the camera icon to capture up to 3 screenshots.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      // 1. Read files into base64 data URLs
      const dataUrls = [];
      for (const uri of screenshots) {
        try {
          const response = await fetch(uri);
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          if (dataUrl && typeof dataUrl === 'string') {
            dataUrls.push(dataUrl);
          }
        } catch (readErr) {
          console.warn('[ChatGPTBrowser] Error reading screenshot URI:', readErr);
        }
      }

      if (dataUrls.length === 0) {
        Alert.alert(
          'Screenshot Error',
          'Could not read the stored screenshot files. Please capture a new screenshot.',
          [{ text: 'OK' }]
        );
        return;
      }

      // 2. Copy the primary screenshot to clipboard as a reliable backup
      try {
        const rawBase64 = dataUrls[0].includes(',')
          ? dataUrls[0].split(',')[1]
          : dataUrls[0];
        if (rawBase64) {
          await Clipboard.setImageAsync(rawBase64);
        }
      } catch (_clipErr) {
        console.warn('[ChatGPTBrowser] Clipboard.setImageAsync error:', _clipErr);
      }

      // 3. Inject script into ChatGPT WebView to attach files or simulate paste
      if (webViewRef.current) {
        const injection = `
          (async function() {
            try {
              const dataUrls = ${JSON.stringify(dataUrls)};
              var attached = false;

              // Method 1: Find file input
              var fileInput = document.querySelector('input[type="file"]');
              if (fileInput) {
                var dt = new DataTransfer();
                for (var i = 0; i < dataUrls.length; i++) {
                  var res = await fetch(dataUrls[i]);
                  var blob = await res.blob();
                  var file = new File([blob], 'screenshot_' + (i + 1) + '.png', { type: 'image/png' });
                  dt.items.add(file);
                }
                fileInput.files = dt.files;
                fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                attached = true;
              }

              // Method 2: Simulate paste on composer
              var composer = document.querySelector('#prompt-textarea') ||
                             document.querySelector('div[contenteditable="true"]') ||
                             document.querySelector('textarea');
              if (composer) {
                composer.focus();
                var dtPaste = new DataTransfer();
                for (var j = 0; j < dataUrls.length; j++) {
                  var resP = await fetch(dataUrls[j]);
                  var blobP = await resP.blob();
                  var fileP = new File([blobP], 'screenshot_' + (j + 1) + '.png', { type: 'image/png' });
                  dtPaste.items.add(fileP);
                }
                var pasteEvt = new ClipboardEvent('paste', {
                  clipboardData: dtPaste,
                  bubbles: true,
                  cancelable: true
                });
                composer.dispatchEvent(pasteEvt);
                attached = true;
              }

              if (attached) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'SCREENSHOTS_PASTED_SUCCESS',
                  count: dataUrls.length
                }));
              } else {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'SCREENSHOTS_PASTE_FAILED',
                  reason: 'No composer input element found'
                }));
              }
            } catch (err) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'SCREENSHOTS_PASTE_FAILED',
                reason: err.message || 'Injection error'
              }));
            }
          })();
          true;
        `;
        webViewRef.current.injectJavaScript(injection);
      }
    } catch (err) {
      console.warn('[ChatGPTBrowser] handlePasteScreenshots error:', err);
      triggerSharingFallback(screenshots);
    }
  }, [screenshots, triggerSharingFallback]);

  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'SCREENSHOTS_PASTED_SUCCESS') {
          Alert.alert(
            'Screenshots Added',
            `Successfully added ${data.count} screenshot(s) to ChatGPT input. Enter your prompt and send.`,
            [{ text: 'OK' }]
          );
        } else if (data.type === 'SCREENSHOTS_PASTE_FAILED') {
          triggerSharingFallback(screenshots);
        }
      } catch (_e) {}
    },
    [screenshots, triggerSharingFallback]
  );

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

      {/* Action Bar: Paste Screenshots & Generate Gmail Draft */}
      <View style={styles.topActionBar}>
        <TouchableOpacity
          style={[
            styles.pasteScreenshotsBtn,
            screenshots.length === 0 && styles.btnDisabled,
          ]}
          onPress={handlePasteScreenshots}
          activeOpacity={0.85}
          accessibilityLabel="Paste Screenshots"
        >
          <Ionicons
            name="images-outline"
            size={16}
            color={screenshots.length === 0 ? '#94a3b8' : '#ffffff'}
          />
          <Text
            style={[
              styles.pasteScreenshotsBtnText,
              screenshots.length === 0 && styles.btnTextDisabled,
            ]}
          >
            Paste Screenshots
          </Text>
          {screenshots.length > 0 && (
            <View style={styles.screenshotCountBadge}>
              <Text style={styles.screenshotCountBadgeText}>
                {screenshots.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.generateDraftBtn}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.85}
          accessibilityLabel="Generate Gmail Draft"
        >
          <Ionicons name="mail" size={16} color="#ffffff" />
          <Text style={styles.generateDraftBtnText}>Generate Draft</Text>
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
          onMessage={handleMessage}
          onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
        />
      </View>

      {/* Enlarged, Clean Generate Gmail Draft Popup */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate Gmail Draft</Text>

              <View style={styles.headerRightActions}>
                <TouchableOpacity
                  style={styles.pasteClipboardBtn}
                  onPress={handlePasteFromClipboard}
                  activeOpacity={0.8}
                >
                  <Ionicons name="clipboard-outline" size={14} color="#0a66c2" />
                  <Text style={styles.pasteClipboardBtnText}>Paste</Text>
                </TouchableOpacity>

                {pastedText.length > 0 && (
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => setPastedText('')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  style={styles.closeIconBtn}
                >
                  <Ionicons name="close" size={22} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Large Multiline Text Input occupying most of the popup */}
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.largeTextInput}
                multiline={true}
                textAlignVertical="top"
                placeholder={
                  'MAIL ADDRESS: recruiter@example.com\n' +
                  'SUBJECT: Job Application\n' +
                  'MAIL:\n' +
                  'Hello,\n' +
                  'Thank you for sharing this opportunity.'
                }
                placeholderTextColor="#94a3b8"
                value={pastedText}
                onChangeText={(text) => setPastedText(cleanPastedText(text))}
                autoCapitalize="none"
                autoCorrect={false}
                scrollEnabled={true}
              />
            </View>

            {/* Clear Action Buttons: Cancel & Submit */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pasteScreenshotsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a66c2',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
    elevation: 2,
  },
  pasteScreenshotsBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  screenshotCountBadge: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  screenshotCountBadgeText: {
    color: '#0a66c2',
    fontSize: 11,
    fontWeight: '800',
  },
  generateDraftBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ea4335',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
    elevation: 2,
  },
  generateDraftBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    backgroundColor: '#e2e8f0',
    elevation: 0,
  },
  btnTextDisabled: {
    color: '#94a3b8',
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

  // Enlarged Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    width: '96%',
    height: '90%',
    maxHeight: '94%',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
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
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    gap: 4,
  },
  pasteClipboardBtnText: {
    color: '#0a66c2',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  clearBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  closeIconBtn: {
    padding: 2,
    marginLeft: 4,
  },
  inputWrapper: {
    flex: 1,
    marginTop: 10,
    marginBottom: 10,
  },
  largeTextInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    padding: 14,
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
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
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 10,
    elevation: 2,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
