import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import { toApiError } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { registerDeviceToken } from "@/lib/services/device-service";

export type PushStatus =
  | "registering"
  | "registered"
  | "permission-denied"
  | "unsupported-device"
  | "failed";

interface RegistrationResult {
  status: PushStatus;
  message: string;
  token: string | null;
}

interface PushValue extends RegistrationResult {
  /** Tries the whole setup again (for example after the user turns notifications on). */
  retry: () => void;
  /** Schedules a LOCAL notification in 5 seconds. It does not use the server. */
  sendLocalTest: () => Promise<void>;
}

// While the app is open, still show incoming notifications as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPush(): Promise<RegistrationResult> {
  if (!Device.isDevice) {
    return {
      status: "unsupported-device",
      message:
        "Push notifications need a real phone. They do not work on simulators or emulators.",
      token: null,
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.status === "granted";
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.status === "granted";
  }
  if (!granted) {
    return {
      status: "permission-denied",
      message:
        "Notifications are turned off. Turn them on in your phone Settings to get urgent notices.",
      token: null,
    };
  }

  let token: string;
  try {
    const extra = Constants.expoConfig?.extra as
      | { eas?: { projectId?: string } }
      | undefined;
    const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const response = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = response.data;
    if (__DEV__) console.log("Expo push token:", token);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "Unknown error";
    return {
      status: "failed",
      message: `Could not create a push token: ${reason}. Remote push may need a development build.`,
      token: null,
    };
  }

  try {
    await registerDeviceToken({
      expo_push_token: token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
  } catch (caught) {
    return {
      status: "failed",
      message: `Token created, but the server did not accept it: ${toApiError(caught).message}`,
      token,
    };
  }

  return {
    status: "registered",
    message: USE_MOCKS
      ? "Token created. Mock mode: it was not sent to the server."
      : "This phone is registered for urgent notices.",
    token,
  };
}

/** ASSUMED payload: the playbook does not document it. We expect data: { channel_id }. */
function readChannelId(data: Record<string, unknown>): number | null {
  const raw = data.channel_id;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

// Remembers which tap was already handled, so signing out and in does not replay it.
let lastHandledNotificationId: string | null = null;

const PushContext = createContext<PushValue | null>(null);

export function PushNotificationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<RegistrationResult>({
    status: "registering",
    message: "Setting up notifications...",
    token: null,
  });
  const [attempt, setAttempt] = useState(0);

  // Register when the user is signed in (this provider only exists inside the signed-in area).
  useEffect(() => {
    let cancelled = false;
    setState({
      status: "registering",
      message: "Setting up notifications...",
      token: null,
    });
    registerForPush()
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setState({
            status: "failed",
            message:
              caught instanceof Error
                ? caught.message
                : "Could not set up notifications.",
            token: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Open the right screen when a notification is tapped (also works when the app was closed).
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    if (
      lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    )
      return;

    const id = lastResponse.notification.request.identifier;
    if (id === lastHandledNotificationId) return;
    lastHandledNotificationId = id;

    const channelId = readChannelId(
      lastResponse.notification.request.content.data ?? {},
    );
    if (channelId !== null) {
      router.push({
        pathname: "/channels/[channelId]",
        params: { channelId: String(channelId) },
      });
    } else {
      router.push("/announcements");
    }
  }, [lastResponse, router]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const sendLocalTest = useCallback(async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "URGENT NOTICE (local test)",
        body: "CITC Lab Room Reassignment: IT314 moved to CEA",
        data: { channel_id: 7 },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 5,
      },
    });
  }, []);

  const value = useMemo<PushValue>(
    () => ({ ...state, retry, sendLocalTest }),
    [state, retry, sendLocalTest],
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePushNotifications(): PushValue {
  const value = useContext(PushContext);
  if (value === null) {
    throw new Error(
      "usePushNotifications must be used inside <PushNotificationProvider>.",
    );
  }
  return value;
}
