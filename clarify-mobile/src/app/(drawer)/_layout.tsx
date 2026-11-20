import { Stack } from 'expo-router';
import React from 'react';

import { ChannelsProvider } from '@/context/ChannelsContext';

export default function DrawerGroupLayout() {
  return (
    <ChannelsProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="announcements" />
        <Stack.Screen name="instructors" />
        <Stack.Screen name="channels/[channelId]" />
      </Stack>
    </ChannelsProvider>
  );
}
