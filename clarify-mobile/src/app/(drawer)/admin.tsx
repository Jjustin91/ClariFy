import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback } from 'react';

import { AdminConsoleView } from '@/components/AdminConsoleView';
import { MobileAppShell } from '@/components/MobileAppShell';
import { useAuth } from '@/context/AuthContext';
import {
  type AdminSectionTab,
  getAdminSectionTitle,
  parseAdminSectionTab,
} from '@/lib/domain-logic';

/**
 * ClariFy Mobile IT Administrator Console screen ported from clarify-web/app/admin/page.tsx.
 * - Deep-links via `/admin?tab=verifications|rbac|roster-sync|metrics` (plus legacy aliases).
 * - Strictly isolated to `it_admin`: non-admin roles immediately redirect to `/`.
 */
export default function MobileAdminScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const { user } = useAuth();

  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const activeTab: AdminSectionTab = parseAdminSectionTab(rawTab);

  const handleSelectTab = useCallback(
    (nextTab: AdminSectionTab) => {
      if (nextTab === activeTab && rawTab === nextTab) {
        return;
      }
      router.setParams({ tab: nextTab });
    },
    [activeTab, rawTab, router]
  );

  if (!user) {
    return null;
  }

  if (user.role !== 'it_admin') {
    return <Redirect href="/" />;
  }

  return (
    <MobileAppShell
      title={getAdminSectionTitle(activeTab)}
      activeAdminTab={activeTab}
    >
      <AdminConsoleView
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />
    </MobileAppShell>
  );
}
