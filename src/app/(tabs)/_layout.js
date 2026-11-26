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
      {/* 1. Unfortunately Hired (Default Tab) */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Unfortunately Hired',
          tabBarLabel: 'Unfort. Hired',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'briefcase' : 'briefcase-outline'}
              size={20}
              color={color}
            />
          ),
        }}
      />

      {/* 2. LinkedIn Automation */}
      <Tabs.Screen
        name="linkedin"
        options={{
          title: 'LinkedIn Automation',
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

      {/* 3. Gemini AI */}
      <Tabs.Screen
        name="gemini"
        options={{
          title: 'Gemini AI',
          tabBarLabel: 'Gemini AI',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'sparkles' : 'sparkles-outline'}
              size={20}
              color={focused ? '#1a73e8' : color}
            />
          ),
        }}
      />

      {/* 4. Form Autofill */}
      <Tabs.Screen
        name="pending2"
        options={{
          title: 'Form Autofill',
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

      {/* Hidden pending3 */}
      <Tabs.Screen
        name="pending3"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
