import { Text, View } from "react-native";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import type { Instructor } from "@/types/api";

export function InstructorCard({ instructor }: { instructor: Instructor }) {
  return (
    <View className="flex-row items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Avatar name={instructor.name} uri={instructor.avatar_url} />

      <View className="flex-1 gap-1">
        <Text className="text-lg font-bold text-ustp-navy">
          {instructor.name}
        </Text>
        {instructor.campus ? (
          <Text className="text-sm text-ustp-text">{instructor.campus}</Text>
        ) : null}
        <Badge label={instructor.department} variant="department" />
      </View>
    </View>
  );
}
