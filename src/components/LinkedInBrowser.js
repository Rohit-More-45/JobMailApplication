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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
  const { setSelectedPostId, isSelected, registerWebView, setCapturedContent } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(LINKEDIN_FEED_URL);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedCount, setDetectedCount] = useState(0);

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

  // Trigger post extraction from the LinkedIn WebView
  const handleExtractAndSend = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof window.__JOBMAIL_EXTRACT_VISIBLE_POST === 'function') {
          window.__JOBMAIL_EXTRACT_VISIBLE_POST();
        }
        true;
      `);
    }
  }, []);

  // Handle messages from injected JavaScript
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'SELECTION_CHANGED') {
          setSelectedPostId(data.postId || null);
        } else if (data.type === 'POST_EXTRACTED' && data.data) {
          // Clear previous and set new captured content
          setCapturedContent(data.data);
          // Navigate to ChatGPT tab
          router.push('/(tabs)/chatgpt');
        } else if (data.type === 'POST_EXTRACT_ERROR') {
          Alert.alert('Notice', data.message || 'Please scroll to a post and try again.');
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
      <BrowserHeader
        canGoBack={canGoBack}
        onGoBack={handleGoBack}
        onReload={handleReload}
        onGoFeed={handleGoFeed}
        onSendToChatGPT={handleExtractAndSend}
        currentUrl={currentUrl}
        loading={loading}
        detectedCount={detectedCount}
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
        )}

        {/* Floating Action Button (FAB) over feed */}
        <TouchableOpacity
          style={styles.floatingButton}
          onPress={handleExtractAndSend}
          activeOpacity={0.88}
        >
          <View style={styles.fabIconBadge}>
            <Ionicons name="sparkles" size={16} color="#ffffff" />
          </View>
          <Text style={styles.floatingButtonText}>
            {isSelected ? 'Send Selected Post ➔' : 'Send Visible Post to ChatGPT ➔'}
          </Text>
        </TouchableOpacity>
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
  floatingButton: {
    position: 'absolute',
    bottom: 18,
    right: 16,
    left: 16,
    backgroundColor: '#0a66c2',
    borderRadius: 28,
    paddingVertical: 12,
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
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10a37f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
