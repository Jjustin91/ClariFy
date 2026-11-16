import type { ComponentRef } from "react";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView } from "react-native";

import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { AnnouncementCardSkeleton } from "@/components/announcements/AnnouncementCardSkeleton";
import { AnnouncementFilterBar } from "@/components/announcements/AnnouncementFilterBar";
import { AnnouncementFormModal } from "@/components/announcements/AnnouncementFormModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { SuccessBanner } from "@/components/ui/SuccessBanner";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useAuthSession } from "@/hooks/useAuthSession";
import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { deleteAnnouncement } from "@/lib/services/announcement-service";
import { MOCK_DATA_NOTICE } from "@/mocks";
import type { Announcement } from "@/types/api";

export default function AnnouncementsScreen() {
  const { user } = useAuthSession();
  // If the role is somehow missing, fall back to the least-privileged role.
  const role = user?.role ?? "student";
  const canAcknowledge = role === "student";
  const isFaculty = role === "faculty";

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [searchText, setSearchText] = useState(""); // what the user is typing
  const [search, setSearch] = useState(""); // what is actually sent to the API
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [department, setDepartment] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);

  // Wait 0.4 seconds after typing stops before searching, and go back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const feed = useAnnouncements(
    { sort: "latest", search: search || undefined, tag, department, page },
    role,
  );

  const hasActiveFilters =
    search !== "" || tag !== undefined || department !== undefined;
  const canRetry =
    feed.error !== null &&
    (feed.error.kind === "network" || feed.error.kind === "server");

  function handleTagChange(next: string | undefined) {
    setTag(next);
    setPage(1);
  }

  function handleDepartmentChange(next: string | undefined) {
    setDepartment(next);
    setPage(1);
  }

  function clearFilters() {
    setSearchText("");
    setSearch("");
    setTag(undefined);
    setDepartment(undefined);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  // ───── Faculty actions ─────

  /** Only notices the signed-in faculty member published (ASSUMPTION; the backend decides). */
  function canManage(announcement: Announcement): boolean {
    return isFaculty && user !== null && announcement.publisher.id === user.id;
  }

  function openCreate() {
    setEditing(null);
    setSuccessMessage(null);
    setFormOpen(true);
  }

  function openEdit(announcement: Announcement) {
    setEditing(announcement);
    setSuccessMessage(null);
    setFormOpen(true);
  }

  function handleSaved(message: string) {
    setFormOpen(false);
    setSuccessMessage(message);
    feed.reload();
  }

  function confirmDelete(announcement: Announcement) {
    Alert.alert("Delete this notice?", announcement.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void runDelete(announcement),
      },
    ]);
  }

  async function runDelete(announcement: Announcement) {
    if (!user) return;
    setDeletingId(announcement.id);
    setDeleteError(null);
    setSuccessMessage(null);
    try {
      await deleteAnnouncement(announcement.id, user);
      setSuccessMessage("Notice deleted.");
      feed.reload();
    } catch (caught) {
      setDeleteError(toApiError(caught));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-ustp-cream"
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {USE_MOCKS ? <Badge label={MOCK_DATA_NOTICE} variant="urgent" /> : null}

        {isFaculty ? (
          <Button title="Create Notice" onPress={openCreate} />
        ) : null}

        {successMessage ? <SuccessBanner message={successMessage} /> : null}

        <AnnouncementFilterBar
          searchText={searchText}
          onSearchTextChange={setSearchText}
          selectedTag={tag}
          onTagChange={handleTagChange}
          selectedDepartment={department}
          onDepartmentChange={handleDepartmentChange}
          hasActiveFilters={hasActiveFilters}
          onClear={clearFilters}
        />

        {feed.actionError ? (
          <ErrorBanner
            title="Could not acknowledge"
            message={feed.actionError.message}
          />
        ) : null}

        {deleteError ? (
          <ErrorBanner
            title={
              deleteError.kind === "forbidden"
                ? "Access Denied"
                : "Could not delete"
            }
            message={deleteError.message}
          />
        ) : null}

        {feed.status === "loading" ? (
          <>
            <AnnouncementCardSkeleton />
            <AnnouncementCardSkeleton />
            <AnnouncementCardSkeleton />
          </>
        ) : null}

        {feed.status === "error" && feed.error ? (
          <ErrorBanner
            title={
              feed.error.kind === "forbidden"
                ? "Access Denied"
                : "Could not load announcements"
            }
            message={feed.error.message}
            onRetry={canRetry ? feed.reload : undefined}
          />
        ) : null}

        {feed.status === "ready" && feed.items.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              title="No announcements match your filters"
              message="Try a different search or remove a filter."
              action={
                <Button
                  title="Clear filters"
                  variant="secondary"
                  onPress={clearFilters}
                />
              }
            />
          ) : (
            <EmptyState
              title="No announcements yet"
              message="New notices from your Course Hubs will appear here."
            />
          )
        ) : null}

        {feed.status === "ready"
          ? feed.items.map((announcement) => {
              const manageable = canManage(announcement);
              return (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  canAcknowledge={canAcknowledge}
                  isAcknowledging={feed.acknowledgingId === announcement.id}
                  onAcknowledge={(id) => void feed.acknowledge(id)}
                  onEdit={manageable ? openEdit : undefined}
                  onDelete={manageable ? confirmDelete : undefined}
                  isDeleting={deletingId === announcement.id}
                />
              );
            })
          : null}

        {feed.status === "ready" && feed.meta && feed.meta.last_page > 1 ? (
          <PaginationControls
            meta={feed.meta}
            onPageChange={changePage}
            noun="notices"
          />
        ) : null}
      </ScrollView>

      {isFaculty && user ? (
        <AnnouncementFormModal
          visible={formOpen}
          editing={editing}
          author={user}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}
