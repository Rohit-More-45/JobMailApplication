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

  // Handle Take Screenshot (maximum 3 limit, no counter, no preview)
  const handleTakeScreenshot = useCallback(async () => {
    if (screenshots.length >= 3) {
      Alert.alert(
        'Maximum Limit Reached',
        'Maximum limit of 3 screenshots reached. Tap the trash icon to clear screenshots.',
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
      }
    } catch (e) {
      console.warn('[LinkedInBrowser] handleTakeScreenshot error:', e);
      setIsCapturing(false);
      Alert.alert('Error', 'Failed to capture screenshot.');
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
                  <ActivityIndicator size="small" color="#0a66c2" />
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

        {/* Compact Floating Screenshot Icons: Camera & Trash only */}
        {!isCapturing && (
          <View style={styles.compactScreenshotDock}>
            {/* Take Screenshot: Small Camera Icon Only */}
            <TouchableOpacity
              style={[
                styles.iconBtn,
                styles.cameraBtn,
                screenshots.length >= 3 && styles.btnDisabled,
              ]}
              onPress={handleTakeScreenshot}
              activeOpacity={0.8}
              accessibilityLabel="Take Screenshot"
            >
              <Ionicons name="camera" size={18} color="#ffffff" />
            </TouchableOpacity>

            {/* Clear Screenshots: Small Trash Icon Only */}
            <TouchableOpacity
              style={[
                styles.iconBtn,
                styles.trashBtn,
                screenshots.length === 0 && styles.trashBtnDisabled,
              ]}
              onPress={handleClearScreenshots}
              activeOpacity={0.8}
              disabled={screenshots.length === 0}
              accessibilityLabel="Clear Screenshots"
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={screenshots.length === 0 ? '#94a3b8' : '#ef4444'}
              />
            </TouchableOpacity>
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
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  errorDescription: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 14,
  },
  retryButton: {
    backgroundColor: '#0a66c2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  compactScreenshotDock: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 6,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtn: {
    backgroundColor: '#0a66c2',
  },
  btnDisabled: {
    backgroundColor: '#94a3b8',
  },
  trashBtn: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  trashBtnDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
});
