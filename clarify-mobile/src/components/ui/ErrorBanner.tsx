import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";

interface ErrorBannerProps {
  message: string;
  title?: string;
  /** If given, a Retry button appears. Leave it out for errors that retrying cannot fix (e.g. 403). */
  onRetry?: () => void;
}

export function ErrorBanner({
  message,
  title = "Something went wrong",
  onRetry,
}: ErrorBannerProps) {
  return (
    <View
      accessibilityRole="alert"
      className="gap-3 rounded-xl border border-red-300 bg-red-50 p-4"
    >
      <View className="gap-1">
        <Text className="text-base font-bold text-red-800">{title}</Text>
        <Text className="text-sm text-red-800">{message}</Text>
      </View>
      {onRetry ? (
        <Button title="Retry" variant="outline" onPress={onRetry} />
      ) : null}
    </View>
  );
}
