import { Stack } from 'expo-router';
import React from 'react';

import { ChannelsProvider } from '@/context/ChannelsContext';
import { RealtimeProvider } from '@/context/RealtimeContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';

function AuthenticatedServicesBridge() {
  usePushNotifications();
  return null;
}

export default function DrawerGroupLayout() {
  return (
    <ChannelsProvider>
      <RealtimeProvider>
        <AuthenticatedServicesBridge />
        <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="announcements" />
          <Stack.Screen name="instructors" />
          <Stack.Screen name="channels/[channelId]" />
        </Stack>
      </RealtimeProvider>
    </ChannelsProvider>
  );
}
