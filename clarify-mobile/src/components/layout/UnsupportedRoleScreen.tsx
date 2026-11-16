import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuthSession } from "@/hooks/useAuthSession";
import type { AuthUser, UserRole } from "@/types/api";

const ROLE_LABELS: Record<UserRole, string> = {
  student: "Student",
  faculty: "Faculty",
  dept_head: "Department Head",
  it_admin: "IT Administrator",
};

/** Shown to roles the mobile app does not cover (playbook ASSUMPTION 1: mobile is for students and faculty). */
export function UnsupportedRoleScreen({ user }: { user: AuthUser }) {
  const { signOut } = useAuthSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
  }

  return (
    <ScrollView className="flex-1 bg-ustp-cream">
      <View className="bg-ustp-navy px-6 pb-10 pt-20">
        <Text className="text-4xl font-bold text-ustp-gold">ClariFy</Text>
        <Text className="mt-1 text-base text-white">
          USTP-CDO campus noticeboard
        </Text>
      </View>

      <View className="gap-4 p-6">
        <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-5">
          <Badge label={ROLE_LABELS[user.role].toUpperCase()} variant="tag" />
          <Text className="text-xl font-bold text-ustp-navy">
            Please use the ClariFy web portal
          </Text>
          <Text className="text-base text-ustp-text">
            You are signed in as {user.name}. The mobile app is for students and
            faculty. The tools for your role are on the web portal.
          </Text>
        </View>

        <Button
          title="Log out"
          loadingTitle="Logging out..."
          variant="secondary"
          loading={isSigningOut}
          onPress={() => void handleSignOut()}
        />
      </View>
    </ScrollView>
  );
}
