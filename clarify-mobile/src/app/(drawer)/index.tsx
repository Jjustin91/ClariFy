import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { PushStatusCard } from "@/components/notifications/PushStatusCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCourseHubs } from "@/hooks/useCourseHubs";
import { USE_MOCKS } from "@/lib/config";
import { MOCK_DATA_NOTICE } from "@/mocks";

export default function DashboardScreen() {
  const router = useRouter();
  const { user, signOut } = useAuthSession();
  const hubs = useCourseHubs();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const firstName = user?.name.split(" ")[0] ?? "";
  const isFaculty = user?.role === "faculty";
  const canRetry =
    hubs.error !== null &&
    (hubs.error.kind === "network" || hubs.error.kind === "server");

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
  }

  return (
    <ScrollView
      className="flex-1 bg-ustp-cream"
      contentContainerStyle={{ padding: 24, gap: 20 }}
    >
      <View className="gap-2 rounded-2xl bg-ustp-navy p-5">
        <Text className="text-2xl font-bold text-ustp-gold">
          Welcome back, {firstName}!
        </Text>
        <View className="flex-row">
          <Badge
            label={isFaculty ? "FACULTY" : "STUDENT"}
            variant={isFaculty ? "tag" : "department"}
          />
        </View>
        <Text className="text-base text-white">
          {isFaculty
            ? "You can publish notices in your Course Hubs and answer inquiries."
            : "You can read notices, acknowledge them, and send inquiries."}
        </Text>
      </View>

      {USE_MOCKS ? <Badge label={MOCK_DATA_NOTICE} variant="urgent" /> : null}

      <View className="gap-3">
        <Text className="text-lg font-semibold text-ustp-navy">
          Your Course Hubs
        </Text>

        {hubs.status === "loading" ? (
          <>
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </>
        ) : null}

        {hubs.status === "error" && hubs.error ? (
          <ErrorBanner
            title={
              hubs.error.kind === "forbidden"
                ? "Access Denied"
                : "Could not load Course Hubs"
            }
            message={hubs.error.message}
            onRetry={canRetry ? hubs.reload : undefined}
          />
        ) : null}

        {hubs.status === "ready" && hubs.items.length === 0 ? (
          <EmptyState
            title="No Course Hubs yet"
            message="Your Course Hubs appear here once your enrollment is synced."
          />
        ) : null}

        {hubs.status === "ready"
          ? hubs.items.map((channel) => (
              <Button
                key={channel.id}
                title={channel.name}
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname: "/channels/[channelId]",
                    params: { channelId: String(channel.id) },
                  })
                }
              />
            ))
          : null}
      </View>

      <PushStatusCard />

      <Button
        title="Log out"
        loadingTitle="Logging out..."
        variant="secondary"
        loading={isSigningOut}
        onPress={() => void handleSignOut()}
      />
    </ScrollView>
  );
}
