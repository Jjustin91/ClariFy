import { View } from "react-native";

import { Skeleton } from "@/components/ui/Skeleton";

export function AnnouncementCardSkeleton() {
  return (
    <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <Skeleton className="h-5 w-24 rounded-full" />
      <Skeleton className="h-6 w-3/4 rounded" />
      <Skeleton className="h-4 w-full rounded" />
      <Skeleton className="h-4 w-5/6 rounded" />
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </View>
  );
}
