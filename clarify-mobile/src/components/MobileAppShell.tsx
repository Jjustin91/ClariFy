import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import { resolveApiAssetUrl } from '../lib/api-client';
import type { AdminSectionTab } from '../lib/domain-logic';
import { formatAdminPendingBadgeLabel } from '../lib/realtime-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import { ClarifyLogoWordmark } from './ClarifyLogo';
import { ProfileSettingsModal } from './ProfileSettingsModal';
import { UrgentAnnouncementModal } from './UrgentAnnouncementModal';

const DRAWER_WIDTH = 288;

interface NavDestination {
  key: string;
  label: string;
  href: string;
  active: boolean;
  adminTab?: AdminSectionTab;
  badge?: number | null;
}

/**
 * Persistent Mobile App Shell ported from clarify-web/src/components/layout/AppShell.tsx.
 * - Sticky ustpNavy (#1a1851) top header bar with ClariFy brand, active title, gold USTP, and orange Menu toggle.
 * - Custom right-hand slide-over Profile & Navigation Sidebar in ustpOrange (#ff9718)
 *   with active highlight in ustpOrangeDark (#ff6418), Settings modal, and Logout confirmation.
 */
export function MobileAppShell({
  title,
  activeAdminTab,
  children,
}: {
  title: string;
  activeAdminTab?: AdminSectionTab;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const {
    primaryChannelId,
    isSidebarOpen,
    setIsSidebarOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
  } = useChannels();
  const realtime = useOptionalRealtime();

  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [slideAnim] = useState(() => new Animated.Value(DRAWER_WIDTH));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  if (isSidebarOpen && !drawerMounted) {
    setDrawerMounted(true);
  }

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        setReduceMotion(Boolean(enabled));
      }
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const duration = reduceMotion ? 0 : 200;
    if (isSidebarOpen) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (drawerMounted) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setDrawerMounted(false);
        }
      });
    }
  }, [isSidebarOpen, drawerMounted, reduceMotion, slideAnim, backdropOpacity]);

  if (!user) {
    return null;
  }

  const isAdmin = user.role === 'it_admin';
  const defaultChannelRoute = `/channels/${primaryChannelId ?? 0}`;

  const isDashboardActive =
    pathname === '/' || pathname === '/index' || pathname === '/(drawer)';
  const isAdminRoute = pathname.includes('/admin') || isDashboardActive;
  const resolvedAdminTab: AdminSectionTab = activeAdminTab || 'verifications';
  const isAnnouncementsActive = pathname.includes('/announcements');
  const isInstructorsActive = pathname.includes('/instructors');
  const isChannelsActive = pathname.includes('/channels');

  const navItems: NavDestination[] = isAdmin
    ? [
        {
          key: 'admin-verifications',
          label: 'Account Verification Queue',
          href: '/admin?tab=verifications',
          adminTab: 'verifications',
          active: isAdminRoute && resolvedAdminTab === 'verifications',
          badge: realtime?.adminPendingCount ?? null,
        },
        {
          key: 'admin-rbac',
          label: 'RBAC Role Management',
          href: '/admin?tab=rbac',
          adminTab: 'rbac',
          active: isAdminRoute && resolvedAdminTab === 'rbac',
        },
        {
          key: 'admin-roster-sync',
          label: 'Account & Roster Sync',
          href: '/admin?tab=roster-sync',
          adminTab: 'roster-sync',
          active: isAdminRoute && resolvedAdminTab === 'roster-sync',
        },
        {
          key: 'admin-metrics',
          label: 'System Metrics & Audit Trail',
          href: '/admin?tab=metrics',
          adminTab: 'metrics',
          active: isAdminRoute && resolvedAdminTab === 'metrics',
        },
      ]
    : [
        {
          key: 'dashboard',
          label: 'Dashboard',
          href: '/',
          active: isDashboardActive,
        },
        {
          key: 'announcements',
          label: 'Announcements',
          href: '/announcements',
          active: isAnnouncementsActive,
        },
        {
          key: 'instructors',
          label: 'View Faculty',
          href: '/instructors',
          active: isInstructorsActive,
        },
        {
          key: 'channels',
          label: 'Course Hubs',
          href: defaultChannelRoute,
          active: isChannelsActive,
        },
      ];

  const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
  const idDisplay =
    user.role === 'faculty'
      ? `Faculty ID: ${user.institutional_id}`
      : user.role === 'it_admin'
        ? `ICTO Admin: ${user.institutional_id}`
        : user.institutional_id;

  const scopeSubtext =
    user.role === 'student'
      ? `${user.academic_profile?.section || 'Section N/A'} • ${
          user.academic_profile?.department || 'CITC'
        }${
          user.academic_profile?.year_level
            ? ` Year ${user.academic_profile.year_level}`
            : ''
        }`
      : user.role === 'it_admin'
        ? 'ICTO System Administration'
        : `${user.academic_profile?.department || 'CITC'} Dept`;

  const handleNavigate = (item: NavDestination) => {
    setIsSidebarOpen(false);
    if (item.active) return;
    if (item.adminTab) {
      if (pathname.includes('/admin')) {
        router.setParams({ tab: item.adminTab });
      } else {
        router.replace(item.href as never);
      }
      return;
    }
    router.push(item.href as never);
  };

  const handleConfirmLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
      setIsLogoutConfirmOpen(false);
      setIsSidebarOpen(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Persistent Top Header Bar (ustpNavy #1a1851) */}
      <View
        style={[
          styles.topBar,
          { paddingTop: Math.max(insets.top, spacing.sm) },
        ]}
      >
        <View style={styles.topBarLeft}>
          <Pressable
            onPress={() => {
              if (isAdmin) {
                if (pathname.includes('/admin')) {
                  router.setParams({ tab: 'verifications' });
                } else {
                  router.replace('/admin?tab=verifications' as never);
                }
                return;
              }
              router.push('/' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel="ClariFy Home"
            style={({ pressed }) => [
              styles.brandButton,
              pressed && styles.pressed,
            ]}
          >
            <ClarifyLogoWordmark height={28} />
          </Pressable>
          <Text style={styles.dividerPipe} accessible={false}>
            |
          </Text>
          <Text numberOfLines={1} style={styles.topBarTitle}>
            {title}
          </Text>
        </View>

        <View style={styles.topBarRight}>
          <Text style={styles.ustpBadgeText}>USTP</Text>
          <Pressable
            onPress={() => setIsSidebarOpen((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              isSidebarOpen
                ? 'Close profile and navigation sidebar'
                : 'Open profile and navigation sidebar'
            }
            accessibilityState={{ expanded: isSidebarOpen }}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={isSidebarOpen ? 'x' : 'menu'}
              size={22}
              color={colors.ustpNavy}
            />
          </Pressable>
        </View>
      </View>

      {/* Visible Realtime Unavailable Banner (never fail silently when REVERB key is blank) */}
      {realtime?.realtimeUnavailableMessage && (
        <View
          accessibilityRole="alert"
          style={styles.realtimeUnavailableBanner}
        >
          <Feather name="wifi-off" size={14} color={colors.warningText} />
          <Text style={styles.realtimeUnavailableText}>
            {realtime.realtimeUnavailableMessage}
          </Text>
        </View>
      )}

      {/* Main Screen Content */}
      <View style={styles.mainContent}>{children}</View>

      {/* Custom Right-Hand Slide-Over Profile & Navigation Sidebar (ustpOrange #ff9718) */}
      <Modal
        visible={drawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setIsSidebarOpen(false)}
      >
        <View style={styles.drawerOverlayRoot}>
          <Animated.View
            style={[styles.drawerBackdrop, { opacity: backdropOpacity }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setIsSidebarOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close navigation sidebar backdrop"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.drawerPanel,
              {
                paddingTop: Math.max(insets.top, spacing.md),
                paddingBottom: Math.max(insets.bottom, spacing.lg),
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            {/* Top Collapse Row */}
            <View style={styles.drawerTopRow}>
              <Pressable
                onPress={() => setIsSidebarOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Collapse profile sidebar"
                style={({ pressed }) => [
                  styles.collapseButton,
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name="chevron-right"
                  size={22}
                  color={colors.ustpNavy}
                />
              </Pressable>
              <Text style={styles.roleLabel}>
                {user.role.replace('_', ' ').toUpperCase()}
              </Text>
            </View>

            <ScrollView
              contentContainerStyle={styles.drawerScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Profile Header matching clarify-web AppShell */}
              <View style={styles.profileSection}>
                <View style={styles.avatarOuterRing}>
                  <View style={styles.avatarInnerRing}>
                    {resolveApiAssetUrl(user.avatar_url) ? (
                      <Image
                        source={{
                          uri: resolveApiAssetUrl(user.avatar_url)!,
                        }}
                        accessibilityLabel={user.name}
                        style={styles.avatarImage}
                      />
                    ) : (
                      <Text style={styles.avatarInitial}>{avatarInitial}</Text>
                    )}
                  </View>
                </View>

                <Text style={styles.profileName}>{user.name}</Text>
                <Text style={styles.profileId}>{idDisplay}</Text>
                <Text style={styles.profileScope}>{scopeSubtext}</Text>
              </View>

              {/* Vertical Navigation Stack */}
              <View style={styles.navStack}>
                {navItems.map((item) => {
                  const positiveBadgeLabel = formatAdminPendingBadgeLabel(
                    item.badge
                  );
                  const isZeroBadge =
                    typeof item.badge === 'number' && item.badge === 0;
                  const badgeLabel =
                    positiveBadgeLabel ?? (isZeroBadge ? '0' : null);
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => handleNavigate(item)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        badgeLabel
                          ? `${item.label}, ${badgeLabel} pending verifications`
                          : item.label
                      }
                      accessibilityState={{ selected: item.active }}
                      style={({ pressed }) => [
                        styles.navItem,
                        item.active && styles.navItemActive,
                        pressed && !item.active && styles.navItemPressed,
                      ]}
                    >
                      <View style={styles.navItemRow}>
                        {badgeLabel && (
                          <View
                            style={[
                              styles.navBadgePill,
                              isZeroBadge
                                ? styles.navBadgePillZero
                                : item.active && styles.navBadgePillActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.navBadgeText,
                                isZeroBadge
                                  ? styles.navBadgeTextZero
                                  : item.active && styles.navBadgeTextActive,
                              ]}
                            >
                              {badgeLabel}
                            </Text>
                          </View>
                        )}
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[
                            styles.navItemText,
                            item.active && styles.navItemTextActive,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* Bottom Pinned Actions: Settings & Logout */}
            <View style={styles.drawerFooter}>
              <Pressable
                onPress={() => {
                  setIsSidebarOpen(false);
                  setIsSettingsModalOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Settings"
                style={({ pressed }) => [
                  styles.footerActionButton,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="settings" size={16} color={colors.ustpText} />
                <Text style={styles.footerActionText}>Settings</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setIsSidebarOpen(false);
                  setIsLogoutConfirmOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Logout"
                style={({ pressed }) => [
                  styles.footerActionButton,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="log-out" size={16} color={colors.ustpText} />
                <Text style={styles.footerActionText}>Logout</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Logout Confirmation Dialog matching clarify-web AppShell */}
      <Modal
        visible={isLogoutConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isLoggingOut) setIsLogoutConfirmOpen(false);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isLoggingOut) setIsLogoutConfirmOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss logout confirmation"
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Log out of ClariFy?</Text>
            <Text style={styles.confirmDesc}>
              You will need to sign in again with your USTP Institutional ID to
              access your Course Hubs and announcements.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setIsLogoutConfirmOpen(false)}
                disabled={isLoggingOut}
                accessibilityRole="button"
                accessibilityLabel="Cancel logout"
                style={({ pressed }) => [
                  styles.confirmCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmLogout()}
                disabled={isLoggingOut}
                accessibilityRole="button"
                accessibilityLabel="Confirm Log out"
                style={({ pressed }) => [
                  styles.confirmLogoutBtn,
                  isLoggingOut && styles.disabledBtn,
                  pressed && !isLoggingOut && styles.pressed,
                ]}
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather name="log-out" size={14} color={colors.white} />
                )}
                <Text style={styles.confirmLogoutText}>
                  {isLoggingOut ? 'Logging out...' : 'Log out'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Profile & SMS Fallback Settings Modal */}
      <ProfileSettingsModal
        visible={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      {/* Global Priority Urgent Announcement Popup (strictly hidden for IT Admins) */}
      {!isAdmin && <UrgentAnnouncementModal />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  topBar: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpNavyBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  brandButton: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    flexShrink: 0,
  },
  dividerPipe: {
    color: colors.placeholder,
    fontSize: typography.sizes.body,
  },
  topBarTitle: {
    flex: 1,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '700',
    color: colors.white,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  ustpBadgeText: {
    fontSize: typography.sizes.body,
    fontWeight: '900',
    color: colors.ustpGold,
    letterSpacing: 1,
  },
  menuButton: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    width: touchTarget.minWidth,
    height: touchTarget.minHeight,
    borderRadius: radii.lg,
    backgroundColor: colors.ustpOrange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  realtimeUnavailableBanner: {
    backgroundColor: colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  realtimeUnavailableText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.warningText,
  },
  mainContent: {
    flex: 1,
  },
  drawerOverlayRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlayBackdrop,
  },
  drawerPanel: {
    width: DRAWER_WIDTH,
    maxWidth: '85%',
    height: '100%',
    backgroundColor: colors.ustpOrange,
    borderLeftWidth: 1,
    borderLeftColor: colors.ustpOrangeDivider,
    ...elevation.overlay,
  },
  drawerTopRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapseButton: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  roleLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
    letterSpacing: 0.8,
  },
  drawerScrollContent: {
    paddingBottom: spacing.lg,
  },
  profileSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpOrangeDivider,
  },
  avatarOuterRing: {
    width: 84,
    height: 84,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    padding: 2,
    backgroundColor: colors.ustpGold,
  },
  avatarInnerRing: {
    flex: 1,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.avatarRingRed,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontSize: typography.sizes.titleLg,
    fontWeight: '900',
    color: colors.ustpNavy,
  },
  profileName: {
    marginTop: spacing.md,
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
    textAlign: 'center',
  },
  profileId: {
    marginTop: 2,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpText,
    textAlign: 'center',
    ...typography.tabularNums,
  },
  profileScope: {
    marginTop: 2,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    textAlign: 'center',
  },
  navStack: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpOrangeDivider,
  },
  navItem: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpOrangeDivider,
  },
  navItemActive: {
    backgroundColor: colors.ustpOrangeDark,
  },
  navItemPressed: {
    backgroundColor: colors.ustpOrangeDark,
    opacity: 0.8,
  },
  navItemRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  navBadgePill: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgePillActive: {
    backgroundColor: colors.ustpGold,
  },
  navBadgePillZero: {
    backgroundColor: colors.ustpGoldSoft,
    borderWidth: 1,
    borderColor: colors.ustpOrangeDivider,
  },
  navBadgeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '900',
    color: colors.ustpGold,
    fontFamily: typography.fontFamilySans,
    ...typography.tabularNums,
  },
  navBadgeTextActive: {
    color: colors.ustpNavy,
  },
  navBadgeTextZero: {
    color: colors.ustpNavy,
  },
  navItemText: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '700',
    color: colors.ustpText,
  },
  navItemTextActive: {
    fontWeight: '900',
  },
  drawerFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.ustpOrangeDivider,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  footerActionButton: {
    minHeight: touchTarget.minHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  footerActionText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  confirmCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...elevation.overlay,
  },
  confirmTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  confirmDesc: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.mutedSlate,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  confirmCancelBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  confirmLogoutBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  confirmLogoutText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  disabledBtn: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.85,
  },
});
