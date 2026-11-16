import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { UnsupportedRoleScreen } from "@/components/layout/UnsupportedRoleScreen";
import { SessionProvider, useAuthSession } from "@/hooks/useAuthSession";
import { USTP_COLORS } from "@/lib/constants";

function RootNavigator() {
  const { status, user } = useAuthSession();

  // While we check for a saved login, show a spinner instead of flashing the login screen.
  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-ustp-cream">
        <ActivityIndicator size="large" color={USTP_COLORS.navy} />
      </View>
    );
  }

  const isSignedIn = status === "signedIn";

  // The mobile app covers students and faculty only. Other roles are pointed to the web portal.
  if (
    isSignedIn &&
    user &&
    user.role !== "student" &&
    user.role !== "faculty"
  ) {
    return <UnsupportedRoleScreen user={user} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(drawer)" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)/login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
