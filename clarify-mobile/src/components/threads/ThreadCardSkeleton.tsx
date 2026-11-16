import { View } from "react-native";

import { Skeleton } from "@/components/ui/Skeleton";

export function ThreadCardSkeleton() {
  return (
    <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <Skeleton className="h-6 w-1/2 rounded" />
      <Skeleton className="h-3 w-2/3 rounded" />
      <Skeleton className="h-5 w-24 rounded-full" />
    </View>
  );
}
