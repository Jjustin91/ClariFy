import { Text, View } from "react-native";

export function SuccessBanner({ message }: { message: string }) {
  return (
    <View
      accessibilityRole="alert"
      className="rounded-xl border border-green-300 bg-green-50 p-4"
    >
      <Text className="text-sm font-semibold text-green-800">{message}</Text>
    </View>
  );
}
