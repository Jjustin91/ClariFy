import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { useAuthSession } from "@/hooks/useAuthSession";
import { ApiError } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";

export default function LoginScreen() {
  const { signIn, sessionExpiredMessage } = useAuthSession();
  const [institutionalId, setInstitutionalId] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function handleLogin() {
    setIsSubmitting(true);
    setError(null);
    try {
      await signIn({ institutional_id: institutionalId.trim(), password });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("server", "Something went wrong. Please try again."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasFieldErrors =
    error !== null && Object.keys(error.fieldErrors).length > 0;
  const showBanner = error !== null && !hasFieldErrors;
  const canRetry =
    error !== null && (error.kind === "network" || error.kind === "server");

  return (
    <ScrollView
      className="flex-1 bg-ustp-cream"
      keyboardShouldPersistTaps="handled"
    >
      <View className="bg-ustp-navy px-6 pb-10 pt-20">
        <Text className="text-4xl font-bold text-ustp-gold">ClariFy</Text>
        <Text className="mt-1 text-base text-white">
          USTP-CDO campus noticeboard
        </Text>
      </View>

      <View className="gap-4 p-6">
        {sessionExpiredMessage ? (
          <ErrorBanner
            title="Session expired"
            message={sessionExpiredMessage}
          />
        ) : null}

        <Input
          label="Institutional ID"
          placeholder="e.g. 2020202020"
          value={institutionalId}
          onChangeText={setInstitutionalId}
          autoCapitalize="none"
          autoCorrect={false}
          error={error?.firstError("institutional_id")}
        />
        <Input
          label="Password"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          error={error?.firstError("password")}
        />

        {showBanner ? (
          <ErrorBanner
            message={error.message}
            onRetry={canRetry ? () => void handleLogin() : undefined}
          />
        ) : null}

        <Button
          title="Log in"
          loadingTitle="Logging in..."
          loading={isSubmitting}
          onPress={() => void handleLogin()}
        />

        {USE_MOCKS ? (
          <View className="gap-1 rounded-xl border border-gray-300 bg-white p-4">
            <Badge label="MOCK MODE: demo accounts" variant="urgent" />
            <Text className="mt-2 text-sm text-ustp-text">
              Student: 2020202020
            </Text>
            <Text className="text-sm text-ustp-text">Faculty: 1010101010</Text>
            <Text className="text-sm text-ustp-text">
              Password: mock-password
            </Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
