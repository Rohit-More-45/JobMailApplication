import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
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
  const [pastedStatus, setPastedStatus] = useState(false);

  // Hardware back button on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack]);

  // Execute paste into ChatGPT
  const triggerPaste = useCallback(() => {
    if (!capturedContent || !capturedContent.fullContent || !webViewRef.current) return;

    const escapedText = JSON.stringify(capturedContent.fullContent);
    webViewRef.current.injectJavaScript(`
      if (window.__JOBMAIL_PASTE_INTO_CHATGPT) {
        window.__JOBMAIL_PASTE_INTO_CHATGPT(${escapedText});
      } else {
        ${CHATGPT_INJECTION_SCRIPT}
        window.__JOBMAIL_PASTE_INTO_CHATGPT(${escapedText});
      }
      true;
    `);

    setPastedStatus(true);
    markPasteDone();
    setTimeout(() => setPastedStatus(false), 4000);
  }, [capturedContent, markPasteDone]);

  // Automatically trigger paste if pendingPaste is true
  useEffect(() => {
    if (pendingPaste && capturedContent && !loading) {
      const timer = setTimeout(() => {
        triggerPaste();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [pendingPaste, capturedContent, loading, triggerPaste]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(CHATGPT_INJECTION_SCRIPT);
      if (pendingPaste && capturedContent) {
        setTimeout(() => {
          triggerPaste();
        }, 1000);
      }
    }
  }, [pendingPaste, capturedContent, triggerPaste]);

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'CHATGPT_PASTE_SUCCESS') {
        setPastedStatus(true);
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

      {/* Extracted Content Banner */}
      {capturedContent && (
        <View style={styles.bannerContainer}>
          <View style={styles.bannerInfo}>
            <Ionicons
              name={pastedStatus ? 'checkmark-circle' : 'clipboard'}
              size={18}
              color={pastedStatus ? '#059669' : '#0a66c2'}
            />
            <Text style={styles.bannerText} numberOfLines={1}>
              {pastedStatus
                ? 'Pasted into ChatGPT prompt!'
                : `Post ready (${capturedContent.author || 'Captured post'})`}
            </Text>
          </View>

          <View style={styles.bannerButtons}>
            <TouchableOpacity
              style={[styles.bannerActionBtn, styles.pasteBtn]}
              onPress={triggerPaste}
            >
              <Ionicons name="arrow-down-circle" size={14} color="#ffffff" />
              <Text style={styles.pasteBtnText}>Paste</Text>
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
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#eff6ff',
    borderBottomWidth: 1,
    borderBottomColor: '#bfdbfe',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bannerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e40af',
  },
  bannerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pasteBtn: {
    backgroundColor: '#0a66c2',
  },
  pasteBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: '#e2e8f0',
  },
  clearBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  webViewWrapper: {
    flex: 1,
    backgroundColor: '#f9f9f9',
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
});
