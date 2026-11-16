import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "https://api.ustpclarify.tech/api/v1"
).replace(/\/+$/, "");

let activeBearerToken: string | null = null;

export function setMobileBearerToken(token: string | null): void {
  activeBearerToken = token;
}

export function getMobileBearerToken(): string | null {
  return activeBearerToken;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(activeBearerToken ? { Authorization: `Bearer ${activeBearerToken}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw {
      status: response.status,
      message: json?.message || "Request failed.",
      errors: json?.errors,
    };
  }

  return json as T;
}

/**
 * Registers the device's Expo push token with POST /api/v1/devices/tokens after login.
 */
export async function registerExpoPushTokenApi(
  expoPushToken: string
): Promise<void> {
  const trimmed = expoPushToken.trim();
  if (!trimmed || !activeBearerToken) {
    return;
  }

  const platform: "ios" | "android" | "web" =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : "web";

  await apiClient("/devices/tokens", {
    method: "POST",
    body: JSON.stringify({
      expo_push_token: trimmed,
      platform,
    }),
  });
}

/**
 * Requests notification permission on a physical mobile device, obtains the Expo push token
 * (using the EAS projectId from app config if present), and posts it to /api/v1/devices/tokens.
 * Silently skips on simulators, web, denied permissions, or any error so login is never blocked.
 */
export async function registerDeviceForPushNotificationsAsync(): Promise<void> {
  try {
    if (!activeBearerToken || Platform.OS === "web" || !Device.isDevice) {
      return;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("urgent-alerts", {
        name: "Urgent Campus Alerts",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return;
    }

    const extra = Constants?.expoConfig?.extra as
      | { eas?: { projectId?: string } }
      | undefined;
    const easConfig = (
      Constants as { easConfig?: { projectId?: string } } | undefined
    )?.easConfig;
    const projectId = extra?.eas?.projectId ?? easConfig?.projectId;

    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const pushToken = tokenResult?.data?.trim();
    if (pushToken) {
      await registerExpoPushTokenApi(pushToken);
    }
  } catch {
    // Non-fatal: never block login or session restore on push registration errors
  }
}

/**
 * Restores an existing Sanctum bearer token in memory and triggers non-blocking push token registration.
 */
export async function restoreMobileSession(token: string | null): Promise<void> {
  setMobileBearerToken(token);
  if (token) {
    await registerDeviceForPushNotificationsAsync();
  }
}

