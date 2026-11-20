import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
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

  const {
    setSelectedPostId,
    registerWebView,
    screenshots,
    addScreenshot,
    clearScreenshots,
  } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Temporarily hide buttons during snapshot capture
  const [isCapturing, setIsCapturing] = useState(false);

  // Register WebView ref with context
  useEffect(() => {
    if (webViewRef.current) {
      registerWebView(webViewRef.current);
    }
  }, [registerWebView]);

  // Android hardware back button
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

  // Handle Take Screenshot
  const handleTakeScreenshot = useCallback(async () => {
    if (screenshots.length >= 3) {
      Alert.alert(
        'Maximum Limit Reached',
        'Maximum limit of 3 screenshots reached (3/3). Please tap "Clear Screenshots" to capture a new set.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setIsCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 80));

      let fileUri = null;
      if (viewShotRef.current) {
        fileUri = await captureRef(viewShotRef.current, {
          format: 'png',
          quality: 0.9,
          result: 'tmpfile',
        });
      }

      setIsCapturing(false);

      if (fileUri) {
        addScreenshot(fileUri);
        const nextCount = screenshots.length + 1;
        if (nextCount >= 3) {
          Alert.alert(
            'Maximum Limit Reached',
            'Screenshots: 3/3 captured. You have reached the maximum limit of 3 screenshots.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (e) {
      console.warn('[LinkedInBrowser] handleTakeScreenshot error:', e);
      setIsCapturing(false);
      Alert.alert('Error', 'Failed to capture screenshot. Please try again.');
    }
  }, [screenshots.length, addScreenshot]);

  // Handle Clear Screenshots
  const handleClearScreenshots = useCallback(() => {
    clearScreenshots();
  }, [clearScreenshots]);

  // Handle messages from injected JavaScript (radio button selection)
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'SELECTION_CHANGED') {
          setSelectedPostId(data.postId || null);
        }
      } catch (_err) {
        // Not a JSON message
      }
    },
    [setSelectedPostId]
  );

  const handleNavigationStateChange = useCallback((navState) => {
    setCanGoBack(navState.canGoBack);
    setLoading(navState.loading);

    if (!navState.loading && webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
      } catch (_e) {}
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(LINKEDIN_INJECTION_SCRIPT);
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
      <BrowserHeader
        canGoBack={canGoBack}
        onGoBack={handleGoBack}
        onReload={handleReload}
        onGoFeed={handleGoFeed}
        loading={loading}
      />

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
            options={{ format: 'png', quality: 0.9 }}
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

        {/* Screenshot Toolbar: Take Screenshot, Clear Screenshots, Counter */}
        {!isCapturing && (
          <View style={styles.screenshotBar}>
            {/* Simple Counter: e.g. Screenshots: 2/3 */}
            <View style={styles.counterBadge}>
              <Ionicons name="images-outline" size={15} color="#0a66c2" />
              <Text style={styles.counterText}>
                Screenshots: {screenshots.length}/3
              </Text>
            </View>

            <View style={styles.buttonRow}>
              {/* Button 1: Take Screenshot */}
              <TouchableOpacity
                style={[
                  styles.takeScreenshotBtn,
                  screenshots.length >= 3 && styles.takeScreenshotBtnDisabled,
                ]}
                onPress={handleTakeScreenshot}
                activeOpacity={0.85}
              >
                <Ionicons name="camera" size={16} color="#ffffff" />
                <Text style={styles.takeScreenshotBtnText}>Take Screenshot</Text>
              </TouchableOpacity>

              {/* Button 2: Clear Screenshots */}
              <TouchableOpacity
                style={[
                  styles.clearScreenshotsBtn,
                  screenshots.length === 0 && styles.clearScreenshotsBtnDisabled,
                ]}
                onPress={handleClearScreenshots}
                activeOpacity={0.85}
                disabled={screenshots.length === 0}
              >
                <Ionicons
                  name="trash-outline"
                  size={15}
                  color={screenshots.length === 0 ? '#94a3b8' : '#ef4444'}
                />
                <Text
                  style={[
                    styles.clearScreenshotsBtnText,
                    screenshots.length === 0 && styles.clearScreenshotsBtnTextDisabled,
                  ]}
                >
                  Clear
                </Text>
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
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: '#0a66c2',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  screenshotBar: {
    position: 'absolute',
    bottom: 16,
    left: 14,
    right: 14,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  counterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f7ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
    gap: 6,
  },
  counterText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a66c2',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  takeScreenshotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a66c2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
    elevation: 2,
  },
  takeScreenshotBtnDisabled: {
    backgroundColor: '#94a3b8',
  },
  takeScreenshotBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  clearScreenshotsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fee2e2',
    gap: 4,
  },
  clearScreenshotsBtnDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  clearScreenshotsBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  clearScreenshotsBtnTextDisabled: {
    color: '#94a3b8',
  },
});
