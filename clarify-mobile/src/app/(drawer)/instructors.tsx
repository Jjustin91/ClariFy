import type { ComponentRef } from "react";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Chip } from "@/components/announcements/AnnouncementFilterBar";
import { InstructorCard } from "@/components/instructors/InstructorCard";
import { InstructorCardSkeleton } from "@/components/instructors/InstructorCardSkeleton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { useInstructors } from "@/hooks/useInstructors";
import { USE_MOCKS } from "@/lib/config";
import { DEPARTMENTS } from "@/lib/constants";
import { MOCK_DATA_NOTICE } from "@/mocks";

export default function InstructorsScreen() {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [searchText, setSearchText] = useState(""); // what the user is typing
  const [search, setSearch] = useState(""); // what is actually sent to the API
  const [department, setDepartment] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  // Wait 0.4 seconds after typing stops before searching, and go back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const directory = useInstructors({
    search: search || undefined,
    department,
    page,
  });

  const hasActiveFilters = search !== "" || department !== undefined;
  const canRetry =
    directory.error !== null &&
    (directory.error.kind === "network" || directory.error.kind === "server");

  function handleDepartmentChange(next: string | undefined) {
    setDepartment(next);
    setPage(1);
  }

  function clearFilters() {
    setSearchText("");
    setSearch("");
    setDepartment(undefined);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-ustp-cream"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {USE_MOCKS ? <Badge label={MOCK_DATA_NOTICE} variant="urgent" /> : null}

      <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Input
          label="Search instructors"
          placeholder="Search by name"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View className="gap-2">
          <Text className="text-sm font-semibold text-ustp-text">
            Department
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {DEPARTMENTS.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={department === item}
                onPress={() =>
                  handleDepartmentChange(department === item ? undefined : item)
                }
              />
            ))}
          </ScrollView>
        </View>
        {hasActiveFilters ? (
          <Button
            title="Clear filters"
            variant="outline"
            onPress={clearFilters}
          />
        ) : null}
      </View>

      {directory.status === "loading" ? (
        <>
          <InstructorCardSkeleton />
          <InstructorCardSkeleton />
          <InstructorCardSkeleton />
        </>
      ) : null}

      {directory.status === "error" && directory.error ? (
        <ErrorBanner
          title={
            directory.error.kind === "forbidden"
              ? "Access Denied"
              : "Could not load instructors"
          }
          message={directory.error.message}
          onRetry={canRetry ? directory.reload : undefined}
        />
      ) : null}

      {directory.status === "ready" && directory.items.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            title="No instructors match your search"
            message="Try a different name or remove the department filter."
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
            title="No instructors found"
            message="Verified faculty members will appear here."
          />
        )
      ) : null}

      {directory.status === "ready"
        ? directory.items.map((instructor) => (
            <InstructorCard key={instructor.id} instructor={instructor} />
          ))
        : null}

      {directory.status === "ready" &&
      directory.meta &&
      directory.meta.last_page > 1 ? (
        <PaginationControls
          meta={directory.meta}
          onPageChange={changePage}
          noun="instructors"
        />
      ) : null}
    </ScrollView>
  );
}
