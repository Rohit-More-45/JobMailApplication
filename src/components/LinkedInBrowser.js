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
  const pendingScreenshotRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  const { setSelectedPostId, isSelected, registerWebView, setCapturedContent } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(LINKEDIN_FEED_URL);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedCount, setDetectedCount] = useState(0);

  // Minimize / Maximize toggle state (- and +)
  const [isMinimized, setIsMinimized] = useState(false);
  // Capturing state to temporarily hide overlays during screenshot
  const [isCapturing, setIsCapturing] = useState(false);

  // Register WebView ref with context
  useEffect(() => {
    if (webViewRef.current) {
      registerWebView(webViewRef.current);
    }
  }, [registerWebView]);

  // Clean up fallback timer on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
    };
  }, []);

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

  // Handle messages from injected JavaScript
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'SELECTION_CHANGED') {
          setSelectedPostId(data.postId || null);
        } else if (data.type === 'POST_EXTRACTED' && data.data) {
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }

          // Combine with captured screenshot
          const screenshotData = pendingScreenshotRef.current || {};
          const combinedContent = {
            ...data.data,
            screenshotUri: screenshotData.screenshotUri || null,
            screenshotBase64: screenshotData.screenshotBase64 || null,
          };

          // Store in context and clipboard
          setCapturedContent(combinedContent);
          setIsCapturing(false);

          // Navigate to ChatGPT tab
          router.push('/(tabs)/chatgpt');
        } else if (data.type === 'DEBUG_LOG') {
          console.log(
            `[JobMail Debug] ${data.subType}:`,
            JSON.stringify(data.details)
          );
          if (data.subType === 'POSTS_SCANNED' && data.details) {
            setDetectedCount(data.details.postsDetected || 0);
          }
        }
      } catch (_err) {
        // Not a JSON message or unexpected format
      }
    },
    [setSelectedPostId, setCapturedContent]
  );

  // Capture Screenshot & Extract Post & Send to ChatGPT
  const handleCaptureAndSend = useCallback(async () => {
    try {
      setIsCapturing(true);

      // Brief delay to allow overlays to hide before snapshotting
      await new Promise((resolve) => setTimeout(resolve, 80));

      let screenshotUri = null;
      let screenshotBase64 = null;

      // 1. Take screenshot of visible WebView
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

      pendingScreenshotRef.current = { screenshotUri, screenshotBase64 };

      // 2. Trigger clean post content extraction in WebView
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (typeof window.__JOBMAIL_EXTRACT_VISIBLE_POST === 'function') {
            window.__JOBMAIL_EXTRACT_VISIBLE_POST();
          } else {
            ${LINKEDIN_INJECTION_SCRIPT}
            if (typeof window.__JOBMAIL_EXTRACT_VISIBLE_POST === 'function') {
              window.__JOBMAIL_EXTRACT_VISIBLE_POST();
            }
          }
          true;
        `);
      }

      // 3. Fallback safety timer: if no POST_EXTRACTED message within 1.5s, proceed with screenshot
      fallbackTimerRef.current = setTimeout(() => {
        setIsCapturing(false);
        const fallbackContent = {
          author: 'LinkedIn Post',
          headline: '',
          text: 'Captured LinkedIn Post Screenshot',
          photos: [],
          fullContent: 'Captured LinkedIn Post Screenshot',
          screenshotUri: screenshotUri,
          screenshotBase64: screenshotBase64,
          postId: 'screenshot_' + Date.now(),
        };
        setCapturedContent(fallbackContent);
        router.push('/(tabs)/chatgpt');
      }, 1500);
    } catch (e) {
      console.warn('[LinkedInBrowser] handleCaptureAndSend error:', e);
      setIsCapturing(false);
    }
  }, [setCapturedContent]);

  const handleNavigationStateChange = useCallback((navState) => {
    setCanGoBack(navState.canGoBack);
    setCurrentUrl(navState.url);
    setLoading(navState.loading);

    if (!navState.loading && webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
        webViewRef.current.injectJavaScript(`
          if (window.__JOBMAIL_TRIGGER_SCAN) {
            window.__JOBMAIL_TRIGGER_SCAN('navigationStateChange');
          }
          true;
        `);
      } catch (_e) {}
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
        webViewRef.current.injectJavaScript(`
          if (window.__JOBMAIL_TRIGGER_SCAN) {
            window.__JOBMAIL_TRIGGER_SCAN('onLoadEnd');
          }
          true;
        `);
      } catch (_e) {}
    }
  }, []);

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

        {/* Floating Capture Overlay with Minimize (-) and Maximize (+) */}
        {!isCapturing && (
          isMinimized ? (
            /* Minimized State: Sleek compact FAB with + toggle and camera button */
            <View style={styles.minimizedContainer}>
              <TouchableOpacity
                style={styles.minimizedExpandBtn}
                onPress={() => setIsMinimized(false)}
                accessibilityLabel="Maximize Controls (+)"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="add" size={22} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.minimizedCaptureBtn}
                onPress={handleCaptureAndSend}
                accessibilityLabel="Capture Post & Screenshot"
                activeOpacity={0.85}
              >
                <Ionicons name="camera" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
          ) : (
            /* Maximized State: Floating action bar with - minimize button */
            <View style={styles.maximizedContainer}>
              {/* Minus (-) Minimize Button */}
              <TouchableOpacity
                style={styles.minimizeBtn}
                onPress={() => setIsMinimized(true)}
                accessibilityLabel="Minimize Controls (-)"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="remove" size={20} color="#ffffff" />
              </TouchableOpacity>

              {/* Main Action Button */}
              <TouchableOpacity
                style={styles.floatingButton}
                onPress={handleCaptureAndSend}
                activeOpacity={0.88}
              >
                <View style={styles.fabIconBadge}>
                  <Ionicons name="camera" size={16} color="#ffffff" />
                </View>
                <Text style={styles.floatingButtonText} numberOfLines={1}>
                  {isSelected
                    ? '📸 Capture Selected Post & Send ➔'
                    : '📸 Capture Post & Send to ChatGPT ➔'}
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

  // Maximized Container with (-) and Main Button
  maximizedContainer: {
    position: 'absolute',
    bottom: 18,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  minimizeBtn: {
    width: 44,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  floatingButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#0a66c2',
    borderRadius: 24,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#0a66c2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  fabIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#10a37f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingButtonText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Minimized Container with (+) and Quick Camera
  minimizedContainer: {
    position: 'absolute',
    bottom: 20,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  minimizedExpandBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  minimizedCaptureBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#0a66c2',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 7,
    shadowColor: '#0a66c2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
