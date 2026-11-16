import { Alert, Linking, Text, View } from "react-native";

import type { BadgeVariant } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { PushStatus } from "@/hooks/usePushNotifications";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const BADGE_LABELS: Record<PushStatus, string> = {
  registering: "SETTING UP",
  registered: "NOTIFICATIONS ON",
  "permission-denied": "NOTIFICATIONS OFF",
  "unsupported-device": "NOT SUPPORTED",
  failed: "SETUP FAILED",
};

const BADGE_VARIANTS: Record<PushStatus, BadgeVariant> = {
  registering: "neutral",
  registered: "success",
  "permission-denied": "urgent",
  "unsupported-device": "neutral",
  failed: "urgent",
};

export function PushStatusCard() {
  const push = usePushNotifications();

  async function handleLocalTest() {
    try {
      await push.sendLocalTest();
      Alert.alert(
        "Test scheduled",
        "In 5 seconds a test notification will arrive. Press the Home button first, then tap the notification when it appears.",
      );
    } catch {
      Alert.alert(
        "Could not schedule the test",
        "Make sure notifications are allowed for this app in your phone Settings.",
      );
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="text-lg font-semibold text-ustp-navy">
        Urgent notifications
      </Text>
      <Badge
        label={BADGE_LABELS[push.status]}
        variant={BADGE_VARIANTS[push.status]}
      />
      <Text className="text-sm text-ustp-text">{push.message}</Text>

      {push.status === "permission-denied" ? (
        <Button
          title="Open phone Settings"
          variant="secondary"
          onPress={() => void Linking.openSettings()}
        />
      ) : null}

      {push.status === "failed" || push.status === "permission-denied" ? (
        <Button title="Try again" variant="outline" onPress={push.retry} />
      ) : null}

      <Button
        title="Send a test notification (local)"
        variant="outline"
        onPress={() => void handleLocalTest()}
      />
      <Text className="text-xs text-gray-600">
        The test is created on this phone, not by the server. It shows how
        tapping a notification opens the right Course Hub.
      </Text>
    </View>
  );
}
