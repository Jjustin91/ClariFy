import { Drawer } from "expo-router/drawer";

import { PushNotificationProvider } from "@/hooks/usePushNotifications";
import { USTP_COLORS } from "@/lib/constants";

export default function DrawerLayout() {
  return (
    <PushNotificationProvider>
      <Drawer
        screenOptions={{
          headerStyle: { backgroundColor: USTP_COLORS.navy },
          headerTintColor: USTP_COLORS.gold,
          drawerStyle: { backgroundColor: USTP_COLORS.cream },
          drawerActiveTintColor: USTP_COLORS.navy,
          drawerActiveBackgroundColor: USTP_COLORS.gold,
          drawerInactiveTintColor: USTP_COLORS.text,
        }}
      >
        <Drawer.Screen
          name="index"
          options={{ drawerLabel: "Dashboard", title: "ClariFy" }}
        />
        <Drawer.Screen
          name="announcements"
          options={{ drawerLabel: "Announcements", title: "Noticeboard" }}
        />
        <Drawer.Screen
          name="instructors"
          options={{
            drawerLabel: "View Instructors",
            title: "View Instructors",
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            drawerLabel: "Profile Settings",
            title: "Profile Settings",
          }}
        />
        <Drawer.Screen
          name="channels/[channelId]"
          options={{
            title: "Course Hub",
            drawerItemStyle: { display: "none" },
          }}
        />
      </Drawer>
    </PushNotificationProvider>
  );
}
