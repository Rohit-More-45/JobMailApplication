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
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CHATGPT_INJECTION_SCRIPT } from '../scripts/chatgptInjection';
import { useSelection } from '../context/SelectionContext';

const CHATGPT_URL = 'https://chatgpt.com';

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
  const { capturedContent, clearCapturedContent, pendingPaste, markPasteDone } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attachStatus, setAttachStatus] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);

  // Hardware back button on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
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
  }, [canGoBack, previewModalVisible]);

  // Execute attaching ONLY the screenshot into ChatGPT
  const triggerAttach = useCallback(() => {
    if (!capturedContent || !capturedContent.screenshotBase64 || !webViewRef.current) return;

    const base64Img = capturedContent.screenshotBase64;
    const escapedBase64 = JSON.stringify(base64Img);

    webViewRef.current.injectJavaScript(`
      if (window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY) {
        window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY(${escapedBase64});
      } else {
        ${CHATGPT_INJECTION_SCRIPT}
        window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY(${escapedBase64});
      }
      true;
    `);

    setAttachStatus(true);
    markPasteDone();
    setTimeout(() => setAttachStatus(false), 4000);
  }, [capturedContent, markPasteDone]);

  // Automatically trigger screenshot attach if pendingPaste is true
  useEffect(() => {
    if (pendingPaste && capturedContent && capturedContent.screenshotBase64 && !loading) {
      const timer = setTimeout(() => {
        triggerAttach();
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [pendingPaste, capturedContent, loading, triggerAttach]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(CHATGPT_INJECTION_SCRIPT);
      if (pendingPaste && capturedContent && capturedContent.screenshotBase64) {
        setTimeout(() => {
          triggerAttach();
        }, 900);
      }
    }
  }, [pendingPaste, capturedContent, triggerAttach]);

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'CHATGPT_ATTACH_SUCCESS') {
        setAttachStatus(true);
      }
    } catch (_e) {}
  }, []);

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
            <Text style={styles.pinnedText}>Pinned</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
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
                {attachStatus ? '✓ Screenshot attached to chat!' : 'Ready for ChatGPT'}
              </Text>
            </View>
          </View>

          <View style={styles.bannerButtons}>
            <TouchableOpacity
              style={[styles.bannerActionBtn, styles.attachBtn]}
              onPress={triggerAttach}
            >
              <Ionicons name="attach" size={15} color="#ffffff" />
              <Text style={styles.attachBtnText}>Attach</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.bannerActionBtn, styles.clearBtn]}
              onPress={clearCapturedContent}
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
                  triggerAttach();
                }}
              >
                <Ionicons name="attach" size={18} color="#ffffff" />
                <Text style={styles.modalAttachBtnText}>Attach Screenshot to ChatGPT</Text>
              </TouchableOpacity>
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
    gap: 12,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
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

  // Modal
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
});
