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
import { LINKEDIN_INJECTION_SCRIPT } from '../scripts/linkedInInjection';
import { useSelection } from '../context/SelectionContext';
import BrowserHeader from './BrowserHeader';

const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';

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

  // Zoom control state (1.0 = 100%, 0.8 = 80%, etc.)
  const [zoomLevel, setZoomLevel] = useState(1.0);

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

  // Apply zoom to WebView
  const applyZoom = useCallback((zoom) => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof window.__JOBMAIL_SET_ZOOM === 'function') {
          window.__JOBMAIL_SET_ZOOM(${zoom});
        } else {
          try {
            document.documentElement.style.zoom = ${zoom};
            document.body.style.zoom = ${zoom};
          } catch(e) {}
        }
        true;
      `);
    }
  }, []);

  // Zoom In (+)
  const handleZoomIn = useCallback(() => {
    const nextZoom = Math.min(1.8, Math.round((zoomLevel + 0.1) * 10) / 10);
    setZoomLevel(nextZoom);
    applyZoom(nextZoom);
  }, [zoomLevel, applyZoom]);

  // Zoom Out (-)
  const handleZoomOut = useCallback(() => {
    const nextZoom = Math.max(0.4, Math.round((zoomLevel - 0.1) * 10) / 10);
    setZoomLevel(nextZoom);
    applyZoom(nextZoom);
  }, [zoomLevel, applyZoom]);

  // Reset Zoom to 100%
  const handleResetZoom = useCallback(() => {
    setZoomLevel(1.0);
    applyZoom(1.0);
  }, [applyZoom]);

  // Capture Screenshot & Send ONLY Screenshot to ChatGPT (No extra text)
  const handleCaptureAndSend = useCallback(async () => {
    try {
      setIsCapturing(true);

      // Brief delay to hide overlay controls before taking snapshot
      await new Promise((resolve) => setTimeout(resolve, 80));

      let screenshotUri = null;
      let screenshotBase64 = null;

      if (viewShotRef.current) {
        try {
          const dataUri = await captureRef(viewShotRef.current, {
            format: 'png',
            quality: 0.85,
            result: 'data-uri',
          });
          screenshotUri = dataUri;
          if (dataUri && dataUri.includes(',')) {
            screenshotBase64 = dataUri.split(',')[1];
          }
        } catch (captureErr) {
          console.warn('[LinkedInBrowser] captureRef error:', captureErr);
        }
      }

      setIsCapturing(false);

      if (screenshotUri && screenshotBase64) {
        // Only screenshot is sent - no extra text
        setCapturedContent({
          screenshotUri: screenshotUri,
          screenshotBase64: screenshotBase64,
          postId: 'screenshot_' + Date.now(),
        });

        // Navigate immediately to ChatGPT tab
        router.push('/(tabs)/chatgpt');
      }
    } catch (e) {
      console.warn('[LinkedInBrowser] handleCaptureAndSend error:', e);
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
        // Not a JSON message or unexpected format
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
          if (zoomLevel !== 1.0) {
            applyZoom(zoomLevel);
          }
        } catch (_e) {}
      }
    },
    [zoomLevel, applyZoom]
  );

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
        if (zoomLevel !== 1.0) {
          applyZoom(zoomLevel);
        }
      } catch (_e) {}
    }
  }, [zoomLevel, applyZoom]);

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

  const zoomPercent = Math.round(zoomLevel * 100);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      {!isCapturing && (
        <BrowserHeader
          canGoBack={canGoBack}
          onGoBack={handleGoBack}
          onReload={handleReload}
          onGoFeed={handleGoFeed}
          onSendToChatGPT={handleCaptureAndSend}
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
            options={{ format: 'png', quality: 0.85 }}
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
        {!isCapturing && (
          isMinimized ? (
            /* Minimized View: Small corner toggle to maximize */
            <View style={styles.minimizedContainer}>
              <TouchableOpacity
                style={styles.minimizedExpandBtn}
                onPress={() => setIsMinimized(false)}
                accessibilityLabel="Show Zoom & Capture Controls"
                activeOpacity={0.85}
              >
                <Ionicons name="expand" size={16} color="#ffffff" />
                <Text style={styles.minimizedText}>{zoomPercent}%</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.minimizedCameraBtn}
                onPress={handleCaptureAndSend}
                accessibilityLabel="Capture Screenshot"
                activeOpacity={0.85}
              >
                <Ionicons name="camera" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
          ) : (
            /* Maximized Floating Toolbar: Screen Zoom In/Out + Screenshot Capture */
            <View style={styles.floatingPanel}>
              {/* Zoom Controls Row */}
              <View style={styles.zoomRow}>
                <View style={styles.zoomControlsGroup}>
                  {/* Zoom Out Button (-) */}
                  <TouchableOpacity
                    style={styles.zoomBtn}
                    onPress={handleZoomOut}
                    accessibilityLabel="Zoom Out (-)"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="remove" size={18} color="#ffffff" />
                  </TouchableOpacity>

                  {/* Zoom Percentage (Tap to Reset to 100%) */}
                  <TouchableOpacity
                    style={styles.zoomBadge}
                    onPress={handleResetZoom}
                    accessibilityLabel="Reset Zoom to 100%"
                  >
                    <Ionicons name="search" size={12} color="#94a3b8" />
                    <Text style={styles.zoomBadgeText}>{zoomPercent}%</Text>
                  </TouchableOpacity>

                  {/* Zoom In Button (+) */}
                  <TouchableOpacity
                    style={styles.zoomBtn}
                    onPress={handleZoomIn}
                    accessibilityLabel="Zoom In (+)"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="add" size={18} color="#ffffff" />
                  </TouchableOpacity>
                </View>

                {/* Minimize Button */}
                <TouchableOpacity
                  style={styles.panelMinimizeBtn}
                  onPress={() => setIsMinimized(true)}
                  accessibilityLabel="Minimize Panel"
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="chevron-down" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Main Screenshot Button */}
              <TouchableOpacity
                style={styles.captureButton}
                onPress={handleCaptureAndSend}
                activeOpacity={0.88}
              >
                <View style={styles.cameraIconBadge}>
                  <Ionicons name="camera" size={16} color="#ffffff" />
                </View>
                <Text style={styles.captureButtonText} numberOfLines={1}>
                  📸 Send Screenshot to ChatGPT ➔
                </Text>
              </TouchableOpacity>
            </View>
          )
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

  // Floating Panel for Zoom & Screenshot
  floatingPanel: {
    position: 'absolute',
    bottom: 14,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 16,
    padding: 10,
    gap: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  zoomControlsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 20,
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  zoomBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  panelMinimizeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButton: {
    height: 46,
    backgroundColor: '#0a66c2',
    borderRadius: 23,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 4,
    shadowColor: '#0a66c2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  cameraIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#10a37f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Minimized state
  minimizedContainer: {
    position: 'absolute',
    bottom: 18,
    right: 14,
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
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0a66c2',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#0a66c2',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
