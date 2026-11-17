import { Stack } from 'expo-router';
import React from 'react';

export default function DrawerGroupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="announcements" />
      <Stack.Screen name="instructors" />
      <Stack.Screen name="channels/[channelId]" />
    </Stack>
  );
}
