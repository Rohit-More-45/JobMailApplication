import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0a66c2',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 80 : 54,
          paddingBottom: Platform.OS === 'ios' ? 22 : 6,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'LinkedIn',
          tabBarLabel: 'LinkedIn',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'globe' : 'globe-outline'}
              size={20}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chatgpt"
        options={{
          title: 'ChatGPT',
          tabBarLabel: 'ChatGPT',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              size={20}
              color={focused ? '#10a37f' : color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="pending2"
        options={{
          title: 'Autofill',
          tabBarLabel: 'Autofill',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'document-text' : 'document-text-outline'}
              size={20}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="pending3"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
