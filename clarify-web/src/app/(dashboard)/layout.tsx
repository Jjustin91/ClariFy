import React from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* TODO [FE-1]: Left ScopedChannelsSidebar, Center Workspace, Right CollapsibleProfileDrawer */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
