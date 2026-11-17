import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/context/AuthContext';

export default function IndexRedirectScreen() {
  const { isAuthenticated, isAuthReady } = useAuth();

  if (!isAuthReady) {
    return null;
  }

  if (isAuthenticated) {
    return <Redirect href="/(drawer)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
