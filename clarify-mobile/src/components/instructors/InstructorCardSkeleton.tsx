import { View } from "react-native";

import { Skeleton } from "@/components/ui/Skeleton";

export function InstructorCardSkeleton() {
  return (
    <View className="flex-row items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Skeleton className="h-14 w-14 rounded-full" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </View>
    </View>
  );
}
