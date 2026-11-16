import { Text, View } from "react-native";

export type BadgeVariant =
  | "urgent"
  | "tag"
  | "department"
  | "success"
  | "neutral";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const CONTAINER_CLASSES: Record<BadgeVariant, string> = {
  urgent: "bg-ustp-orange",
  tag: "bg-ustp-blue",
  department: "bg-ustp-sky",
  success: "bg-green-700",
  neutral: "bg-gray-200",
};

const TEXT_CLASSES: Record<BadgeVariant, string> = {
  urgent: "text-ustp-text",
  tag: "text-white",
  department: "text-ustp-text",
  success: "text-white",
  neutral: "text-ustp-text",
};

export function Badge({ label, variant = "neutral" }: BadgeProps) {
  return (
    <View
      className={`self-start rounded-full px-3 py-1 ${CONTAINER_CLASSES[variant]}`}
    >
      <Text className={`text-xs font-bold ${TEXT_CLASSES[variant]}`}>
        {label}
      </Text>
    </View>
  );
}
