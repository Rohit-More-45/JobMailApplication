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
import { useSelection } from '../context/SelectionContext';

const HIRING_CAFE_URL = 'https://hiringcafe.com/';

const CUSTOM_USER_AGENT = Platform.select({
  android:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  default: undefined,
});

/**
 * Script to intercept window.open and target="_blank" links
 * ensuring they pass through onShouldStartLoadWithRequest.
 */
const HC_INJECTION_SCRIPT = `
(function() {
  if (window.__hcInjected) return;
  window.__hcInjected = true;

  // Intercept window.open calls
  var originalOpen = window.open;
  window.open = function(url, target, features) {
    if (url) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'LINK_CLICKED',
          url: url
        }));
      } catch (_e) {
        window.location.href = url;
      }
      return null;
    }
    return originalOpen ? originalOpen.apply(window, arguments) : null;
  };

  // Intercept clicks on links with target="_blank"
  document.addEventListener('click', function(e) {
    var anchor = e.target && e.target.closest ? e.target.closest('a') : null;
    if (anchor && anchor.href) {
      if (anchor.target === '_blank') {
        anchor.target = '_self';
      }
    }
  }, true);
})();
true;
`;

function isHiringCafeHost(host) {
  return (
    host === 'hiringcafe.com' ||
    host.endsWith('.hiringcafe.com') ||
    host === 'hiring.cafe' ||
    host.endsWith('.hiring.cafe')
  );
}

/**
 * Checks whether a URL is an external job / employer application URL.
 * Internal Hiring Cafe pages stay in Tab 1; external job links route to Tab 2 (LinkedIn).
 */
function getExternalDestination(url) {
  if (!url || typeof url !== 'string') return null;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (isHiringCafeHost(host)) {
      const redirectParams = ['url', 'target', 'dest', 'redirect', 'to', 'link', 'out', 'apply_url', 'job_url'];
      for (const param of redirectParams) {
        const val = parsed.searchParams.get(param);
        if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
          const destParsed = new URL(val);
          const destHost = destParsed.hostname.toLowerCase();
          if (!isHiringCafeHost(destHost)) {
            return val;
          }
        }
      }
      return null;
    }

    // Allow common auth/challenge/CDN hosts inside Tab 1 if needed, route job/employer sites to Tab 2
    return url;
  } catch (_e) {
    return null;
  }
}

export default function HiringCafeBrowser() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);
  const { navigateToJobUrl } = useSelection();

  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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

  // Handle link interception
  const handleShouldStartLoadWithRequest = useCallback(
    (request) => {
      const { url, isTopFrame } = request;
      if (
        !url ||
        url === 'about:blank' ||
        url.startsWith('javascript:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return true;
      }

      // Only intercept top-frame navigations; allow iframes/embeds/scripts to load normally
      if (isTopFrame === false) {
        return true;
      }

      if (url.startsWith('intent://')) {
        try {
          const match = url.match(/S\.browser_fallback_url=([^;]+)/);
          if (match && match[1]) {
            const fallbackUrl = decodeURIComponent(match[1]);
            const externalFallback = getExternalDestination(fallbackUrl);
            if (externalFallback) {
              navigateToJobUrl(externalFallback);
              return false;
            }
          }
        } catch (_e) {}
        return false;
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return false;
      }

      const externalUrl = getExternalDestination(url);
      if (externalUrl) {
        navigateToJobUrl(externalUrl);
        return false;
      }

      return true;
    },
    [navigateToJobUrl]
  );

  // Handle messages from injected JavaScript (e.g. window.open interception)
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (!data) return;

        if (data.type === 'LINK_CLICKED' && data.url) {
          const externalUrl = getExternalDestination(data.url);
          if (externalUrl) {
            navigateToJobUrl(externalUrl);
          } else if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`
              window.location.href = ${JSON.stringify(data.url)};
              true;
            `);
          }
        }
      } catch (_e) {}
    },
    [navigateToJobUrl]
  );

  const handleGoHome = useCallback(() => {
    setHasError(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        window.location.href = '${HIRING_CAFE_URL}';
        true;
      `);
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

  const handleError = useCallback((syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    const desc = nativeEvent?.description || '';
    const code = nativeEvent?.code;
    if (
      code === -3 ||
      code === -999 ||
      desc.includes('ERR_ABORTED') ||
      desc.includes('ERR_UNKNOWN_URL_SCHEME')
    ) {
      return;
    }
    setHasError(true);
    setErrorMessage(desc || 'Could not load Hiring Cafe.');
  }, []);

  return (
    <View style={styles.container}>
      {/* Compact Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="cafe" size={15} color="#ffffff" />
          </View>
          <Text style={styles.brandTitle} numberOfLines={1}>
            Hiring Cafe
          </Text>
        </View>

        <View style={styles.actionsRow}>
          {canGoBack && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={handleGoBack}
              accessibilityLabel="Go back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={18} color="#334155" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleGoHome}
            accessibilityLabel="Home"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="home-outline" size={17} color="#334155" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleReload}
            accessibilityLabel="Reload page"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={loading ? 'sync' : 'reload'}
              size={17}
              color={loading ? '#0a66c2' : '#334155'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main WebView occupying almost the entire screen */}
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
            source={{ uri: HIRING_CAFE_URL }}
            style={styles.webView}
            userAgent={CUSTOM_USER_AGENT}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            allowsInlineMediaPlayback={true}
            setSupportMultipleWindows={false}
            originWhitelist={['*']}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color="#0a66c2" />
              </View>
            )}
            injectedJavaScriptBeforeContentLoaded={HC_INJECTION_SCRIPT}
            injectedJavaScript={HC_INJECTION_SCRIPT}
            onLoadEnd={() => setLoading(false)}
            onMessage={handleMessage}
            onNavigationStateChange={(nav) => {
              setCanGoBack(nav.canGoBack);
              setLoading(nav.loading);
            }}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            onError={handleError}
          />
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
    paddingHorizontal: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
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
    flex: 1,
  },
  logoBadge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#d97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
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
});
