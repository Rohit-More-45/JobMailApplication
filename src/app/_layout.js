import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SelectionProvider } from '../context/SelectionContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SelectionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </SelectionProvider>
    </SafeAreaProvider>
  );
}
