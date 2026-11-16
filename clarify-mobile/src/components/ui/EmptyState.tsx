import type { ReactNode } from "react";
import { Text, View } from "react-native";

interface EmptyStateProps {
  title: string;
  message?: string;
  /** Optional button or link, e.g. <Button title="Clear filters" ... />. */
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <View className="items-center gap-2 rounded-2xl border border-gray-300 bg-white px-6 py-10">
      <Text className="text-center text-lg font-bold text-ustp-navy">
        {title}
      </Text>
      {message ? (
        <Text className="text-center text-base text-ustp-text">{message}</Text>
      ) : null}
      {action ? <View className="mt-3 self-stretch">{action}</View> : null}
    </View>
  );
}
