import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelection } from '../context/SelectionContext';

export default function BrowserHeader({
  canGoBack = false,
  onGoBack,
  onReload,
  onGoFeed,
  loading = false,
}) {
  const insets = useSafeAreaInsets();
  const { isSelected, clearSelection } = useSelection();

  return (
    <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.topRow}>
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="mail" size={16} color="#ffffff" />
          </View>
          <Text style={styles.brandTitle}>JobMail</Text>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>V1</Text>
          </View>
        </View>

        <View style={styles.actionsContainer}>
          {canGoBack && (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onGoBack}
              accessibilityLabel="Go back in browser"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color="#334155" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconButton}
            onPress={onGoFeed}
            accessibilityLabel="Go to LinkedIn Feed"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="home-outline" size={18} color="#334155" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconButton}
            onPress={onReload}
            accessibilityLabel="Refresh page"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={loading ? 'sync' : 'reload'}
              size={18}
              color={loading ? '#0a66c2' : '#334155'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected Post Status (if user tapped a radio button) */}
      {isSelected && (
        <View style={styles.statusRow}>
          <View style={styles.selectionPillActive}>
            <View style={styles.activeDot} />
            <Text style={styles.selectionTextActive} numberOfLines={1}>
              1 Post Selected
            </Text>
            <TouchableOpacity
              onPress={clearSelection}
              style={styles.clearButton}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="close-circle" size={16} color="#0a66c2" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingBottom: 4,
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#0a66c2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  versionBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  versionText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statusRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionPillActive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#0a66c2',
  },
  selectionTextActive: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0a66c2',
  },
  clearButton: {
    marginLeft: 4,
  },
});
