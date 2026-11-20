import Constants from 'expo-constants';
import * as Device from 'expo-device';
import {
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  AndroidImportance,
  getExpoPushTokenAsync,
  getLastNotificationResponseAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
  type NotificationResponse,
} from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import { registerExpoPushTokenApi } from '../lib/api-client';
import { resolvePushNotificationRoute } from '../lib/realtime-reducer';

const URGENT_ALERTS_CHANNEL_ID = 'urgent-alerts';

let isNotificationHandlerConfigured = false;

function ensureForegroundNotificationHandler(): void {
  if (isNotificationHandlerConfigured || Platform.OS === 'web') {
    return;
  }
  isNotificationHandlerConfigured = true;
  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function resolveExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return null;
  }

  if (Platform.OS === 'android') {
    await setNotificationChannelAsync(URGENT_ALERTS_CHANNEL_ID, {
      name: 'Urgent Campus Alerts',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#fcb315',
    });
  }

  const { status: existingStatus } = await getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  const easConfig = (
    Constants as { easConfig?: { projectId?: string } } | undefined
  )?.easConfig;
  const projectId = extra?.eas?.projectId ?? easConfig?.projectId;

  const tokenResult = await getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  const pushToken = tokenResult?.data?.trim();
  return pushToken && pushToken.length > 0 ? pushToken : null;
}

/**
 * Registers the device Expo push token via POST /api/v1/devices/token (NFR-02),
 * displays foreground urgent banners, refreshes feeds on foreground arrival,
 * and deep-links tapped notifications (both live and cold-start) to the target hub/announcement.
 */
export function usePushNotifications(): void {
  const { user, isAuthenticated, isAuthReady, showToast } = useAuth();
  const { channels } = useChannels();
  const realtime = useOptionalRealtime();
  const router = useRouter();

  const registeredForUserIdRef = useRef<number | null>(null);
  const handledNotificationIdsRef = useRef<Set<string>>(new Set());
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // 1. Configure foreground notification handler once
  useEffect(() => {
    ensureForegroundNotificationHandler();
  }, []);

  // 2. Register Expo push token once per authenticated user session via POST /devices/token
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!isAuthenticated || !user?.id) {
      registeredForUserIdRef.current = null;
      return;
    }

    if (registeredForUserIdRef.current === user.id) {
      return;
    }

    let cancelled = false;

    const registerToken = async () => {
      try {
        const pushToken = await resolveExpoPushToken();
        if (cancelled || !pushToken) {
          return;
        }
        await registerExpoPushTokenApi(pushToken);
        if (!cancelled) {
          registeredForUserIdRef.current = user.id;
        }
      } catch {
        // Non-fatal: never block navigation or leak push token diagnostics
      }
    };

    void registerToken();

    return () => {
      cancelled = true;
    };
  }, [isAuthReady, isAuthenticated, user?.id]);

  // 3. Foreground receipt + tap-to-open deep linking (including cold-start notification response)
  useEffect(() => {
    if (Platform.OS === 'web' || !isAuthReady || !isAuthenticated || !user?.id) {
      return;
    }

    const handleNotificationResponse = (
      response: NotificationResponse | null
    ) => {
      if (!response) return;

      const notificationId = response.notification.request.identifier;
      if (handledNotificationIdsRef.current.has(notificationId)) {
        return;
      }
      handledNotificationIdsRef.current.add(notificationId);

      const rawData = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const knownCourseHubIds = new Set<number>(
        channelsRef.current
          .filter((ch) => !ch.channel_type || ch.channel_type === 'course_hub')
          .map((ch) => Number(ch.id))
      );

      const destination = resolvePushNotificationRoute(
        rawData,
        knownCourseHubIds
      );
      if (destination) {
        router.push(destination as never);
      }
    };

    const receivedSub = addNotificationReceivedListener((notification) => {
      const title = notification.request.content.title?.trim();
      if (title) {
        showToast(title, 'info');
      }
      realtime?.triggerAnnouncementRefresh();
    });

    const responseSub = addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });

    void getLastNotificationResponseAsync()
      .then((lastResponse) => {
        handleNotificationResponse(lastResponse);
      })
      .catch(() => {
        // Ignore cold-start lookup errors on unsupported runtimes
      });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [isAuthReady, isAuthenticated, user?.id, router, showToast, realtime]);
}
