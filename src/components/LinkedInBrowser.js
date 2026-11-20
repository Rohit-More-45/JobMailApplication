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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { LINKEDIN_INJECTION_SCRIPT } from '../scripts/linkedInInjection';
import { useSelection } from '../context/SelectionContext';
import BrowserHeader from './BrowserHeader';

const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';

const VIEW_MODES = [
  { key: 'normal', label: 'Normal', desc: 'Original' },
  { key: 'compact', label: 'Compact', desc: 'More content' },
  { key: 'extra_compact', label: 'Extra Compact', desc: 'Max content' },
];

const CUSTOM_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

export default function LinkedInBrowser() {
  const webViewRef = useRef(null);
  const viewShotRef = useRef(null);

  const { setSelectedPostId, registerWebView, setCapturedContent } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(LINKEDIN_FEED_URL);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedCount, setDetectedCount] = useState(0);

  // Three Viewing Modes: 'normal', 'compact', 'extra_compact'
  const [viewMode, setViewMode] = useState('compact');

  // Minimize / Maximize floating panel state
  const [isMinimized, setIsMinimized] = useState(false);

  // Capturing state to temporarily hide overlays during screenshot
  const [isCapturing, setIsCapturing] = useState(false);

  // Register WebView ref with context
  useEffect(() => {
    if (webViewRef.current) {
      registerWebView(webViewRef.current);
    }
  }, [registerWebView]);

  // Android hardware back button handling
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );
    return () => subscription.remove();
  }, [canGoBack]);

  // Apply viewing mode to WebView
  const applyViewMode = useCallback((mode) => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof window.__JOBMAIL_SET_VIEW_MODE === 'function') {
          window.__JOBMAIL_SET_VIEW_MODE('${mode}');
        } else if (typeof window.__JOBMAIL_SET_ZOOM === 'function') {
          window.__JOBMAIL_SET_ZOOM('${mode}');
        }
        true;
      `);
    }
  }, []);

  // User changes view mode: persists across browsing
  const handleSelectViewMode = useCallback(
    (mode) => {
      setViewMode(mode);
      applyViewMode(mode);
    },
    [applyViewMode]
  );

  // Capture Screenshot & Share via Android Native Share Sheet (expo-sharing)
  // Preserves screenshot as image attachment and allows selecting intended ChatGPT conversation
  const handleShareToChatGPT = useCallback(async () => {
    try {
      setIsCapturing(true);

      // Brief delay to hide overlay controls before taking snapshot
      await new Promise((resolve) => setTimeout(resolve, 80));

      let fileUri = null;
      let dataUri = null;

      if (viewShotRef.current) {
        try {
          // File URI for native Android Sharing intent
          fileUri = await captureRef(viewShotRef.current, {
            format: 'png',
            quality: 0.92,
            result: 'tmpfile',
          });

          // Data URI for in-app context
          dataUri = await captureRef(viewShotRef.current, {
            format: 'png',
            quality: 0.88,
            result: 'data-uri',
          });
        } catch (captureErr) {
          console.warn('[LinkedInBrowser] captureRef error:', captureErr);
        }
      }

      setIsCapturing(false);

      if (dataUri && dataUri.includes(',')) {
        const shotId = 'shot_' + Date.now();
        setCapturedContent({
          screenshotUri: dataUri,
          screenshotBase64: dataUri.split(',')[1],
          fileUri: fileUri,
          postId: shotId,
        });
      }

      // Launch Android native Share Sheet
      if (fileUri) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'image/png',
            dialogTitle: 'Share Screenshot to ChatGPT',
            UTI: 'public.png',
          });
          return;
        }
      }

      // Fallback: navigate to in-app ChatGPT tab if sharing is unavailable
      router.push('/(tabs)/chatgpt');
    } catch (e) {
      console.warn('[LinkedInBrowser] handleShareToChatGPT error:', e);
      setIsCapturing(false);
    }
  }, [setCapturedContent]);

  // Option to open in-app ChatGPT tab directly
  const handleOpenInAppTab = useCallback(async () => {
    try {
      setIsCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 80));

      let dataUri = null;
      let fileUri = null;

      if (viewShotRef.current) {
        dataUri = await captureRef(viewShotRef.current, {
          format: 'png',
          quality: 0.88,
          result: 'data-uri',
        });
        fileUri = await captureRef(viewShotRef.current, {
          format: 'png',
          quality: 0.90,
          result: 'tmpfile',
        });
      }

      setIsCapturing(false);

      if (dataUri && dataUri.includes(',')) {
        const shotId = 'shot_' + Date.now();
        setCapturedContent({
          screenshotUri: dataUri,
          screenshotBase64: dataUri.split(',')[1],
          fileUri: fileUri,
          postId: shotId,
        });
        router.push('/(tabs)/chatgpt');
      }
    } catch (e) {
      console.warn('[LinkedInBrowser] handleOpenInAppTab error:', e);
      setIsCapturing(false);
    }
  }, [setCapturedContent]);

  // Handle messages from injected JavaScript
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'SELECTION_CHANGED') {
          setSelectedPostId(data.postId || null);
        } else if (data.type === 'DEBUG_LOG') {
          if (data.subType === 'POSTS_SCANNED' && data.details) {
            setDetectedCount(data.details.postsDetected || 0);
          }
        }
      } catch (_err) {
        // Not a JSON message
      }
    },
    [setSelectedPostId]
  );

  const handleNavigationStateChange = useCallback(
    (navState) => {
      setCanGoBack(navState.canGoBack);
      setCurrentUrl(navState.url);
      setLoading(navState.loading);

      if (!navState.loading && webViewRef.current) {
        try {
          webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
          applyViewMode(viewMode);
        } catch (_e) {}
      }
    },
    [viewMode, applyViewMode]
  );

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
        applyViewMode(viewMode);
      } catch (_e) {}
    }
  }, [viewMode, applyViewMode]);

  const handleReload = useCallback(() => {
    setHasError(false);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  }, []);

  const handleGoBack = useCallback(() => {
    if (canGoBack && webViewRef.current) {
      webViewRef.current.goBack();
    }
  }, [canGoBack]);

  const handleGoFeed = useCallback(() => {
    setHasError(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        window.location.href = '${LINKEDIN_FEED_URL}';
        true;
      `);
    }
  }, []);

  const handleError = useCallback((syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    setHasError(true);
    setErrorMessage(nativeEvent.description || 'Could not load LinkedIn.');
  }, []);

  const currentModeInfo = VIEW_MODES.find((m) => m.key === viewMode) || VIEW_MODES[1];

  return (
    <View style={styles.container}>
      {/* Top Header */}
      {!isCapturing && (
        <BrowserHeader
          canGoBack={canGoBack}
          onGoBack={handleGoBack}
          onReload={handleReload}
          onGoFeed={handleGoFeed}
          onSendToChatGPT={handleShareToChatGPT}
          currentUrl={currentUrl}
          loading={loading}
          detectedCount={detectedCount}
        />
      )}

      <View style={styles.webViewContainer}>
        {hasError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Connection Issue</Text>
            <Text style={styles.errorDescription}>{errorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ViewShot
            ref={viewShotRef}
            options={{ format: 'png', quality: 0.92 }}
            style={styles.viewShotContainer}
          >
            <WebView
              ref={webViewRef}
              source={{ uri: LINKEDIN_FEED_URL }}
              style={styles.webView}
              userAgent={CUSTOM_USER_AGENT}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={true}
              scalesPageToFit={true}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#0a66c2" />
                  <Text style={styles.loadingText}>Loading LinkedIn...</Text>
                </View>
              )}
              injectedJavaScriptBeforeContentLoaded={LINKEDIN_INJECTION_SCRIPT}
              injectedJavaScript={LINKEDIN_INJECTION_SCRIPT}
              onLoadEnd={handleLoadEnd}
              onMessage={handleMessage}
              onNavigationStateChange={handleNavigationStateChange}
              onError={handleError}
              onHttpError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                if (nativeEvent.statusCode >= 500) {
                  setHasError(true);
                  setErrorMessage(`HTTP Server Error ${nativeEvent.statusCode}`);
                }
              }}
            />
          </ViewShot>
        )}

        {/* Floating Zoom & Screenshot Controls */}
        {!isCapturing &&
          (isMinimized ? (
            /* Minimized View: Small corner toggle to maximize */
            <View style={styles.minimizedContainer}>
              <TouchableOpacity
                style={styles.minimizedExpandBtn}
                onPress={() => setIsMinimized(false)}
                accessibilityLabel="Show View Mode Controls"
                activeOpacity={0.85}
              >
                <Ionicons name="expand" size={14} color="#38bdf8" />
                <Text style={styles.minimizedText}>{currentModeInfo.label}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.minimizedCameraBtn}
                onPress={handleShareToChatGPT}
                accessibilityLabel="Share Screenshot to ChatGPT"
                activeOpacity={0.85}
              >
                <Ionicons name="share-social" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
          ) : (
            /* Maximized Floating Toolbar: Three View Modes + Share Actions */
            <View style={styles.floatingPanel}>
              {/* Three Viewing Options Selector */}
              <View style={styles.viewModeHeaderRow}>
                <View style={styles.viewModeTitleGroup}>
                  <Ionicons name="resize" size={14} color="#94a3b8" />
                  <Text style={styles.viewModeSectionTitle}>VIEW MODE</Text>
                </View>
                <TouchableOpacity
                  style={styles.panelMinimizeBtn}
                  onPress={() => setIsMinimized(true)}
                  accessibilityLabel="Minimize Panel"
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="chevron-down" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <View style={styles.segmentedControl}>
                {VIEW_MODES.map((mode) => {
                  const isActive = viewMode === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[
                        styles.segmentButton,
                        isActive && styles.segmentButtonActive,
                      ]}
                      onPress={() => handleSelectViewMode(mode.key)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.segmentButtonText,
                          isActive && styles.segmentButtonTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionRow}>
                {/* Primary: Share to ChatGPT via Android Native Share Sheet */}
                <TouchableOpacity
                  style={styles.primaryShareBtn}
                  onPress={handleShareToChatGPT}
                  activeOpacity={0.88}
                >
                  <Ionicons name="share-social" size={17} color="#ffffff" />
                  <Text style={styles.primaryShareBtnText} numberOfLines={1}>
                    📸 Share to ChatGPT
                  </Text>
                </TouchableOpacity>

                {/* Secondary: In-App ChatGPT Tab */}
                <TouchableOpacity
                  style={styles.inAppTabBtn}
                  onPress={handleOpenInAppTab}
                  activeOpacity={0.85}
                  accessibilityLabel="Open In-App ChatGPT Tab"
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#ffffff" />
                  <Text style={styles.inAppTabBtnText}>In-App</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#f3f2ef',
    position: 'relative',
  },
  viewShotContainer: {
    flex: 1,
    backgroundColor: '#f3f2ef',
  },
  webView: {
    flex: 1,
    backgroundColor: '#f3f2ef',
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
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  errorDescription: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#0a66c2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Floating Panel
  floatingPanel: {
    position: 'absolute',
    bottom: 12,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 16,
    padding: 10,
    gap: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  viewModeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  viewModeTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewModeSectionTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  panelMinimizeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 12,
    padding: 3,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentButtonActive: {
    backgroundColor: '#0a66c2',
    shadowColor: '#0a66c2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  segmentButtonTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryShareBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#10a37f',
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 4,
    shadowColor: '#10a37f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  primaryShareBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  inAppTabBtn: {
    height: 44,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  inAppTabBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Minimized state
  minimizedContainer: {
    position: 'absolute',
    bottom: 16,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  minimizedExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    gap: 6,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  minimizedText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  minimizedCameraBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#10a37f',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#10a37f',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
