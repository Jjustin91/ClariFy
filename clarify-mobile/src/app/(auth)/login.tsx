import React, { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import {
  apiClient,
  registerDeviceForPushNotificationsAsync,
  registerExpoPushTokenApi,
  setMobileBearerToken,
} from "../../lib/api-client";

interface LoginResponse {
  token: string;
  data: {
    id: number;
    institutional_id: string;
    name: string;
    role: string;
  };
}

export default function MobileLoginScreen() {
  const [institutionalId, setInstitutionalId] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (expoPushTokenOverride?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await apiClient<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          institutional_id: institutionalId.trim(),
          password,
        }),
      });
      setMobileBearerToken(res.token);
      if (expoPushTokenOverride) {
        await registerExpoPushTokenApi(expoPushTokenOverride).catch(() => {
          // Non-fatal if push registration fails
        });
      } else {
        await registerDeviceForPushNotificationsAsync();
      }
      setStatusMessage(`Signed in as ${res.data.name}`);
    } catch (err) {
      const apiErr = err as { message?: string };
      setStatusMessage(apiErr?.message || "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#FFFAF2" }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: "#1a1851", marginBottom: 8 }}>
        USTP ClariFy Mobile
      </Text>
      <TextInput
        value={institutionalId}
        onChangeText={setInstitutionalId}
        placeholder="Institutional ID"
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: "#cbd5e1",
          backgroundColor: "#ffffff",
          borderRadius: 6,
          padding: 12,
          marginBottom: 12,
          color: "#031c2e",
        }}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        style={{
          borderWidth: 1,
          borderColor: "#cbd5e1",
          backgroundColor: "#ffffff",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
          color: "#031c2e",
        }}
      />
      <Pressable
        onPress={() => void handleLogin()}
        disabled={isSubmitting}
        style={{
          backgroundColor: "#1a1851",
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 6,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fcb315", fontWeight: "700" }}>
          {isSubmitting ? "Signing In..." : "Sign In"}
        </Text>
      </Pressable>
      {statusMessage ? (
        <Text style={{ marginTop: 12, fontSize: 13, color: "#031c2e" }}>
          {statusMessage}
        </Text>
      ) : null}
    </View>
  );
}
