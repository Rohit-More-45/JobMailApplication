import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  Image,
  Modal,
  Linking,
  Alert,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { CHATGPT_INJECTION_SCRIPT } from '../scripts/chatgptInjection';
import { useSelection } from '../context/SelectionContext';

const CHATGPT_URL = 'https://chatgpt.com';

const REQUIRED_PROMPT_TEMPLATE = `Analyze this job post screenshot and write an email application using this exact format:

MAIL ADDRESS: recipient@example.com
SUBJECT: Email subject here
MAIL:
Complete email body here.`;

function sanitizeBody(body) {
  if (!body) return '';
  let cleaned = body;
  const cutoffs = [
    /(?:\r?\n)\s*[-*_]{3,}\s*(?:\r?\n[\s\S]*)?$/i,
    /(?:\r?\n)\s*(?:note|ps|p\.s\.)\s*:\s*[\s\S]*$/i,
    /(?:\r?\n)\s*(?:let me know if|hope this helps|feel free to|good luck with)[\s\S]*$/i,
    /(?:\r?\n)\s*(?:make sure to attach|remember to attach|don't forget to attach)[\s\S]*$/i,
  ];
  for (const c of cutoffs) {
    cleaned = cleaned.replace(c, '');
  }
  return cleaned.trim();
}

// Parses text in the required three-field format
function parseEmailFromText(text) {
  if (!text) return null;

  const cleaned = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\*\*/g, '').replace(/__/g, '');

  const addrMatch = cleaned.match(/(?:^|\n)\s*MAIL\s*ADD?RESS\s*:\s*([^\r\n]+)/i);
  const rawAddress = addrMatch ? addrMatch[1].trim() : '';

  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const emailInAddr = rawAddress.match(emailRegex);
  const validEmail = emailInAddr ? emailInAddr[1] : '';

  const subjMatch = cleaned.match(/(?:^|\n)\s*SUBJECT\s*:\s*([^\r\n]+)/i);
  const subject = subjMatch ? subjMatch[1].trim() : '';

  const bodyMatch = cleaned.match(/(?:^|\n)\s*MAIL\s*:\s*([\s\S]*)$/i);
  let body = bodyMatch ? bodyMatch[1].trim() : '';

  if (body) {
    body = body.replace(/(?:^|\n)\s*MAIL\s*ADD?RESS\s*:\s*[^\r\n]+/gi, '');
    body = body.replace(/(?:^|\n)\s*SUBJECT\s*:\s*[^\r\n]+/gi, '');
    body = sanitizeBody(body);
  }

  if (!body && !subject && !rawAddress) return null;

  return {
    isValid: !!validEmail,
    address: validEmail,
    rawAddress: rawAddress,
    subject: subject,
    body: body,
  };
}

const CHATGPT_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

export default function ChatGPTBrowser() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);
  const attachedPostIdsRef = useRef(new Set());

  const {
    capturedContent,
    clearCapturedContent,
    pendingPaste,
    markPasteDone,
    detectedEmail,
    setDetectedEmail,
    clearDetectedEmail,
  } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attachStatus, setAttachStatus] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [pinnedTitle, setPinnedTitle] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [promptCopiedFeedback, setPromptCopiedFeedback] = useState(false);
  const [gmailOpening, setGmailOpening] = useState(false);

  // Hardware back button on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (emailModalVisible) {
        setEmailModalVisible(false);
        return true;
      }
      if (previewModalVisible) {
        setPreviewModalVisible(false);
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
  }, [canGoBack, previewModalVisible, emailModalVisible]);

  // Open Gmail with pre-filled To, Subject, and Body (strictly with validation)
  const openGmail = useCallback(async (emailData) => {
    if (!emailData) return false;

    const rawAddr = (emailData.address || emailData.rawAddress || '').trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const isValid = emailRegex.test(rawAddr);

    // Requirement: If the recipient address is missing or invalid, show an error instead of opening an incorrectly addressed email.
    if (!isValid) {
      Alert.alert(
        'Invalid Recipient Email',
        rawAddr
          ? `The recipient address "${rawAddr}" is not a valid email address. Please make sure ChatGPT includes a valid email address in the "MAIL ADDRESS:" field.`
          : 'No recipient email address was found in the ChatGPT reply. Please ensure the reply includes "MAIL ADDRESS: recipient@example.com".',
        [{ text: 'OK' }]
      );
      return false;
    }

    const parts = [];
    if (emailData.subject) {
      parts.push(`subject=${encodeURIComponent(emailData.subject)}`);
    }
    const cleanBody = sanitizeBody(emailData.body);
    if (cleanBody) {
      parts.push(`body=${encodeURIComponent(cleanBody)}`);
    }

    const query = parts.length > 0 ? `?${parts.join('&')}` : '';
    const mailtoUrl = `mailto:${rawAddr}${query}`;

    try {
      setGmailOpening(true);
      await Linking.openURL(mailtoUrl);
      setTimeout(() => setGmailOpening(false), 2000);
      return true;
    } catch (err) {
      console.warn('[ChatGPTBrowser] openGmail error:', err);
      setGmailOpening(false);
      Alert.alert(
        'Could Not Open Gmail',
        'Unable to open your email client automatically. You can copy the email text using the "Copy" button below and paste it directly into Gmail.',
        [{ text: 'OK' }]
      );
      return false;
    }
  }, []);

  // Execute attaching EXACTLY ONE screenshot into ChatGPT
  const triggerAttach = useCallback(
    (force = false) => {
      if (!capturedContent || !capturedContent.screenshotBase64 || !webViewRef.current) return;

      const postId = capturedContent.postId || 'post_' + Date.now();

      // Prevent duplicate attachment of the same screenshot
      if (!force && attachedPostIdsRef.current.has(postId)) {
        return;
      }

      // Synchronously record as attached to prevent race conditions
      attachedPostIdsRef.current.add(postId);
      markPasteDone();

      const base64Img = capturedContent.screenshotBase64;
      const escapedBase64 = JSON.stringify(base64Img);
      const escapedPostId = JSON.stringify(postId);

      webViewRef.current.injectJavaScript(`
        if (window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY) {
          window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY(${escapedBase64}, ${escapedPostId}, ${force ? 'true' : 'false'});
        } else {
          ${CHATGPT_INJECTION_SCRIPT}
          window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY(${escapedBase64}, ${escapedPostId}, ${force ? 'true' : 'false'});
        }
        true;
      `);

      setAttachStatus(true);
      setTimeout(() => setAttachStatus(false), 4000);
    },
    [capturedContent, markPasteDone]
  );

  // Automatically trigger screenshot attach once when ready
  useEffect(() => {
    if (
      pendingPaste &&
      capturedContent &&
      capturedContent.screenshotBase64 &&
      !loading
    ) {
      const postId = capturedContent.postId || 'post_default';
      if (!attachedPostIdsRef.current.has(postId)) {
        const timer = setTimeout(() => {
          triggerAttach(false);
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [pendingPaste, capturedContent, loading, triggerAttach]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(CHATGPT_INJECTION_SCRIPT);
    }
  }, []);

  // Handle messages from ChatGPT injected script
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'CHATGPT_ATTACH_SUCCESS') {
          setAttachStatus(true);
        } else if (data.type === 'CHATGPT_FIRST_PINNED_FOUND') {
          if (data.title) setPinnedTitle(data.title);
        } else if (data.type === 'CHATGPT_EMAIL_DETECTED') {
          if (data.data) {
            const sanitized = {
              ...data.data,
              body: sanitizeBody(data.data.body),
            };
            setDetectedEmail(sanitized);

            // Automatically open Gmail if the extracted recipient address is valid
            if (sanitized.isValid) {
              openGmail(sanitized);
            } else {
              // Show error alert if recipient address is missing or invalid
              Alert.alert(
                'Invalid Recipient Email',
                sanitized.rawAddress
                  ? `The recipient address "${sanitized.rawAddress}" is not a valid email address. Please make sure ChatGPT includes a valid email in the "MAIL ADDRESS:" field.`
                  : 'No recipient email address was found in the ChatGPT reply. Please ensure the reply includes "MAIL ADDRESS: recipient@example.com".',
                [{ text: 'OK' }]
              );
            }
          }
        } else if (data.type === 'CHATGPT_OPEN_GMAIL') {
          if (data.data) {
            const sanitized = {
              ...data.data,
              body: sanitizeBody(data.data.body),
            };
            setDetectedEmail(sanitized);
            openGmail(sanitized);
          }
        }
      } catch (_e) {}
    },
    [setDetectedEmail, openGmail]
  );

  // Manual trigger to scan page for drafted email
  const handleScanForEmail = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof window.__JOBMAIL_DETECT_EMAIL === 'function') {
          window.__JOBMAIL_DETECT_EMAIL(true);
        }
        true;
      `);
    }
  }, []);

  // Copy prompt template to clipboard
  const handleCopyPromptTemplate = useCallback(async () => {
    await Clipboard.setStringAsync(REQUIRED_PROMPT_TEMPLATE);
    setPromptCopiedFeedback(true);
    setTimeout(() => setPromptCopiedFeedback(false), 2500);
    Alert.alert(
      'Prompt Template Copied!',
      'The required ChatGPT response format has been copied to your clipboard. Paste it into your message prompt in ChatGPT.',
      [{ text: 'OK' }]
    );
  }, []);

  // Paste reply from clipboard and open Gmail (useful when using external ChatGPT app)
  const handlePasteAndOpenGmail = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || text.trim().length === 0) {
        Alert.alert(
          'Clipboard Empty',
          'Please copy the email reply from ChatGPT first, then tap here to open Gmail.'
        );
        return;
      }

      const parsed = parseEmailFromText(text);
      if (!parsed || (!parsed.body && !parsed.subject)) {
        Alert.alert(
          'Unrecognized Format',
          'The copied text does not match the required format:\n\nMAIL ADDRESS: recipient@example.com\nSUBJECT: Subject line\nMAIL:\nBody text',
          [{ text: 'OK' }]
        );
        return;
      }

      setDetectedEmail(parsed);
      openGmail(parsed);
    } catch (err) {
      console.warn('[ChatGPTBrowser] handlePasteAndOpenGmail error:', err);
    }
  }, [openGmail, setDetectedEmail]);

  // Copy full drafted email to clipboard
  const handleCopyEmail = useCallback(async () => {
    if (!detectedEmail) return;
    const cleanBody = sanitizeBody(detectedEmail.body);
    const fullText = [
      `MAIL ADDRESS: ${detectedEmail.address || detectedEmail.rawAddress || ''}`,
      `SUBJECT: ${detectedEmail.subject || ''}`,
      'MAIL:',
      cleanBody,
    ].join('\n');

    await Clipboard.setStringAsync(fullText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2500);
  }, [detectedEmail]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="chatbubble-ellipses" size={16} color="#ffffff" />
          </View>
          <Text style={styles.brandTitle}>ChatGPT</Text>
          <View style={styles.pinnedBadge}>
            <Ionicons name="pin" size={10} color="#059669" />
            <Text style={styles.pinnedText} numberOfLines={1}>
              {pinnedTitle ? `Pinned: ${pinnedTitle}` : 'First Pinned Chat'}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {/* Scan for Email Button */}
          <TouchableOpacity
            style={styles.scanEmailHeaderBtn}
            onPress={handleScanForEmail}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            accessibilityLabel="Scan for Email"
          >
            <Ionicons name="mail-unread-outline" size={16} color="#ea4335" />
            <Text style={styles.scanEmailHeaderText}>Scan</Text>
          </TouchableOpacity>

          {canGoBack && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => webViewRef.current?.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color="#334155" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => webViewRef.current?.reload()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name={loading ? 'sync' : 'reload'} size={18} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Helper Bar for Prompt Template & Quick Paste */}
      <View style={styles.helperBar}>
        <TouchableOpacity
          style={styles.helperPill}
          onPress={handleCopyPromptTemplate}
          activeOpacity={0.8}
        >
          <Ionicons
            name={promptCopiedFeedback ? 'checkmark' : 'copy-outline'}
            size={12}
            color="#0284c7"
          />
          <Text style={styles.helperPillText}>
            {promptCopiedFeedback ? 'Copied Prompt Format!' : 'Copy Prompt Format'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.helperPill, styles.helperPillGmail]}
          onPress={handlePasteAndOpenGmail}
          activeOpacity={0.8}
        >
          <Ionicons name="paper-plane" size={12} color="#ea4335" />
          <Text style={[styles.helperPillText, styles.helperPillGmailText]}>
            Paste Reply ➔ Gmail
          </Text>
        </TouchableOpacity>
      </View>

      {/* Captured Screenshot Preview Banner */}
      {capturedContent && capturedContent.screenshotUri && (
        <View style={styles.bannerContainer}>
          <View style={styles.bannerLeft}>
            {/* Screenshot Thumbnail */}
            <TouchableOpacity
              onPress={() => setPreviewModalVisible(true)}
              activeOpacity={0.8}
              style={styles.thumbnailWrapper}
            >
              <Image
                source={{ uri: capturedContent.screenshotUri }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              <View style={styles.zoomBadge}>
                <Ionicons name="expand" size={10} color="#ffffff" />
              </View>
            </TouchableOpacity>

            <View style={styles.bannerInfo}>
              <Text style={styles.bannerTitle} numberOfLines={1}>
                Screenshot Captured
              </Text>
              <Text style={styles.bannerStatus} numberOfLines={1}>
                {attachStatus
                  ? '✓ Attached to First Pinned Chat'
                  : pinnedTitle
                  ? `Target: Pinned "${pinnedTitle}"`
                  : 'Posting to First Pinned Chat'}
              </Text>
            </View>
          </View>

          <View style={styles.bannerButtons}>
            <TouchableOpacity
              style={[styles.bannerActionBtn, styles.attachBtn]}
              onPress={() => triggerAttach(true)}
            >
              <Ionicons name="attach" size={15} color="#ffffff" />
              <Text style={styles.attachBtnText}>Attach</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.bannerActionBtn, styles.clearBtn]}
              onPress={() => {
                if (capturedContent && capturedContent.postId) {
                  attachedPostIdsRef.current.delete(capturedContent.postId);
                }
                clearCapturedContent();
              }}
            >
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Full Screenshot Preview Modal */}
      {capturedContent && capturedContent.screenshotUri && (
        <Modal
          visible={previewModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setPreviewModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Captured Post Screenshot</Text>
                <TouchableOpacity
                  onPress={() => setPreviewModalVisible(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={22} color="#ffffff" />
                </TouchableOpacity>
              </View>

              <Image
                source={{ uri: capturedContent.screenshotUri }}
                style={styles.modalImage}
                resizeMode="contain"
              />

              <TouchableOpacity
                style={styles.modalAttachBtn}
                onPress={() => {
                  setPreviewModalVisible(false);
                  triggerAttach(true);
                }}
              >
                <Ionicons name="attach" size={18} color="#ffffff" />
                <Text style={styles.modalAttachBtnText}>Attach Screenshot to ChatGPT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Full Email Draft Preview Modal */}
      {detectedEmail && (
        <Modal
          visible={emailModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setEmailModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.emailModalContent}>
              <View style={styles.modalHeader}>
                <View style={styles.emailModalHeaderTitleRow}>
                  <View style={styles.gmailIconBadge}>
                    <Ionicons name="mail" size={15} color="#ffffff" />
                  </View>
                  <Text style={styles.modalTitle}>Drafted Email for Gmail</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEmailModalVisible(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={22} color="#ffffff" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.emailModalScroll}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                <Text style={styles.emailModalLabel}>MAIL ADDRESS (TO)</Text>
                <Text
                  style={[
                    styles.emailModalValue,
                    !detectedEmail.isValid && styles.emailModalValueInvalid,
                  ]}
                >
                  {detectedEmail.address ||
                    detectedEmail.rawAddress ||
                    '(Missing - invalid recipient)'}
                </Text>

                <Text style={styles.emailModalLabel}>SUBJECT</Text>
                <Text style={styles.emailModalValue}>
                  {detectedEmail.subject || '(No subject)'}
                </Text>

                <Text style={styles.emailModalLabel}>MAIL (BODY)</Text>
                <View style={styles.emailModalBodyContainer}>
                  <Text style={styles.emailModalBody}>
                    {detectedEmail.body || '(No body text)'}
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.emailModalFooter}>
                <TouchableOpacity
                  style={styles.modalCopyBtn}
                  onPress={handleCopyEmail}
                >
                  <Ionicons
                    name={copyFeedback ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color="#334155"
                  />
                  <Text style={styles.modalCopyBtnText}>
                    {copyFeedback ? 'Copied!' : 'Copy All'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalOpenGmailBtn,
                    !detectedEmail.isValid && styles.modalOpenGmailBtnDisabled,
                  ]}
                  onPress={() => {
                    setEmailModalVisible(false);
                    openGmail(detectedEmail);
                  }}
                >
                  <Ionicons name="paper-plane" size={16} color="#ffffff" />
                  <Text style={styles.modalOpenGmailBtnText}>✉️ Open in Gmail</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* ChatGPT WebView */}
      <View style={styles.webViewWrapper}>
        <WebView
          ref={webViewRef}
          source={{ uri: CHATGPT_URL }}
          style={styles.webView}
          userAgent={CHATGPT_USER_AGENT}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          injectedJavaScriptBeforeContentLoaded={CHATGPT_INJECTION_SCRIPT}
          injectedJavaScript={CHATGPT_INJECTION_SCRIPT}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={(nav) => {
            setCanGoBack(nav.canGoBack);
            setLoading(nav.loading);
          }}
          onMessage={handleMessage}
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#10a37f" />
              <Text style={styles.loadingText}>Opening ChatGPT...</Text>
            </View>
          )}
          startInLoadingState={true}
        />

        {/* Floating Gmail Ready Bottom Card */}
        {detectedEmail && (
          <View style={styles.emailFloatingCard}>
            <View style={styles.emailCardTop}>
              <View style={styles.emailCardTitleGroup}>
                <View style={styles.gmailIconBadge}>
                  <Ionicons name="mail" size={13} color="#ffffff" />
                </View>
                <Text style={styles.emailCardTitle}>Gmail Draft Ready</Text>
                {detectedEmail.isValid ? (
                  <View style={styles.validBadge}>
                    <Text style={styles.validBadgeText}>Valid Email</Text>
                  </View>
                ) : (
                  <View style={styles.invalidBadge}>
                    <Text style={styles.invalidBadgeText}>Address Missing/Invalid</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={clearDetectedEmail}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.emailCardDismiss}
              >
                <Ionicons name="close" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <View style={styles.emailCardFields}>
              <Text style={styles.emailCardLine} numberOfLines={1}>
                <Text style={styles.emailCardFieldLabel}>To: </Text>
                <Text
                  style={[
                    styles.emailCardFieldValue,
                    !detectedEmail.isValid && styles.emailCardFieldValueInvalid,
                  ]}
                >
                  {detectedEmail.address ||
                    detectedEmail.rawAddress ||
                    'Missing (required)'}
                </Text>
              </Text>
              <Text style={styles.emailCardLine} numberOfLines={1}>
                <Text style={styles.emailCardFieldLabel}>Subject: </Text>
                <Text style={styles.emailCardFieldValue}>
                  {detectedEmail.subject || '(Draft ready)'}
                </Text>
              </Text>
            </View>

            <View style={styles.emailCardButtons}>
              {/* Primary: Open in Gmail & Send */}
              <TouchableOpacity
                style={[
                  styles.cardOpenGmailBtn,
                  !detectedEmail.isValid && styles.cardOpenGmailBtnDisabled,
                ]}
                onPress={() => openGmail(detectedEmail)}
                activeOpacity={0.85}
              >
                <Ionicons name="paper-plane" size={14} color="#ffffff" />
                <Text style={styles.cardOpenGmailBtnText} numberOfLines={1}>
                  {gmailOpening ? 'Opening Gmail...' : '✉️ Open in Gmail & Send'}
                </Text>
              </TouchableOpacity>

              {/* Copy Button */}
              <TouchableOpacity
                style={styles.cardCopyBtn}
                onPress={handleCopyEmail}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={copyFeedback ? 'checkmark' : 'copy-outline'}
                  size={14}
                  color={copyFeedback ? '#059669' : '#334155'}
                />
                <Text
                  style={[
                    styles.cardCopyBtnText,
                    copyFeedback && styles.cardCopyBtnTextSuccess,
                  ]}
                >
                  {copyFeedback ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>

              {/* View Full Draft */}
              <TouchableOpacity
                style={styles.cardViewBtn}
                onPress={() => setEmailModalVisible(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="eye-outline" size={14} color="#334155" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
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
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
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
  },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    gap: 3,
  },
  pinnedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scanEmailHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  scanEmailHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ea4335',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Helper bar
  helperBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 8,
  },
  helperPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#bae6fd',
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  helperPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  helperPillGmail: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  helperPillGmailText: {
    color: '#ea4335',
  },

  // Banner
  bannerContainer: {
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#bbf7d0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  thumbnailWrapper: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#10a37f',
    position: 'relative',
    backgroundColor: '#1e293b',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 2,
    borderTopLeftRadius: 4,
  },
  bannerInfo: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  bannerStatus: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
    marginTop: 1,
  },
  bannerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  attachBtn: {
    backgroundColor: '#10a37f',
  },
  attachBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  clearBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },

  // WebView
  webViewWrapper: {
    flex: 1,
    backgroundColor: '#ffffff',
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
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

  // Floating Gmail Ready Card
  emailFloatingCard: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 16,
    padding: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(234, 67, 53, 0.4)',
    gap: 8,
  },
  emailCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emailCardTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gmailIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ea4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailCardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  validBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  validBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
  invalidBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  invalidBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
  emailCardDismiss: {
    padding: 2,
  },
  emailCardFields: {
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  emailCardLine: {
    fontSize: 12,
  },
  emailCardFieldLabel: {
    color: '#94a3b8',
    fontWeight: '700',
  },
  emailCardFieldValue: {
    color: '#f8fafc',
    fontWeight: '500',
  },
  emailCardFieldValueInvalid: {
    color: '#f87171',
    fontWeight: '700',
  },
  emailCardButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  cardOpenGmailBtn: {
    flex: 1,
    height: 40,
    backgroundColor: '#ea4335',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    elevation: 4,
  },
  cardOpenGmailBtnDisabled: {
    backgroundColor: '#64748b',
    opacity: 0.7,
  },
  cardOpenGmailBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  cardCopyBtn: {
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cardCopyBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  cardCopyBtnTextSuccess: {
    color: '#059669',
  },
  cardViewBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Modal Common
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    overflow: 'hidden',
    padding: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalImage: {
    width: '100%',
    height: 420,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  modalAttachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10a37f',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
    gap: 8,
  },
  modalAttachBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Full Email Modal
  emailModalContent: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    padding: 18,
  },
  emailModalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emailModalScroll: {
    maxHeight: 400,
    marginTop: 8,
  },
  emailModalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    marginTop: 10,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  emailModalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emailModalValueInvalid: {
    color: '#dc2626',
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  emailModalBodyContainer: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 120,
  },
  emailModalBody: {
    fontSize: 13,
    color: '#1e293b',
    lineHeight: 20,
  },
  emailModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
  },
  modalCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  modalCopyBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOpenGmailBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ea4335',
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
    elevation: 3,
  },
  modalOpenGmailBtnDisabled: {
    backgroundColor: '#94a3b8',
    opacity: 0.7,
  },
  modalOpenGmailBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
