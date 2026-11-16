import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import type { PaginationMeta } from "@/types/api";

interface PaginationControlsProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  /** Word for the items being counted, e.g. "notices". */
  noun?: string;
  disabled?: boolean;
}

export function PaginationControls({
  meta,
  onPageChange,
  noun = "results",
  disabled = false,
}: PaginationControlsProps) {
  const isFirst = meta.current_page <= 1;
  const isLast = meta.current_page >= meta.last_page;

  return (
    <View className="gap-3">
      <Text className="text-center text-sm text-ustp-text">
        Page {meta.current_page} of {meta.last_page} ({meta.total} {noun})
      </Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            title="Previous"
            variant="outline"
            disabled={disabled || isFirst}
            onPress={() => onPageChange(meta.current_page - 1)}
          />
        </View>
        <View className="flex-1">
          <Button
            title="Next"
            variant="outline"
            disabled={disabled || isLast}
            onPress={() => onPageChange(meta.current_page + 1)}
          />
        </View>
      </View>
    </View>
  );
}
