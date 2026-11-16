import { ActivityIndicator, Pressable, Text } from "react-native";

import { UI_COLORS, USTP_COLORS } from "@/lib/constants";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** While true: shows a spinner and blocks taps (prevents duplicate submissions). */
  loading?: boolean;
  /** Text shown while loading, e.g. "Publishing...". */
  loadingTitle?: string;
  disabled?: boolean;
}

const CONTAINER_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-ustp-navy",
  secondary: "bg-ustp-gold",
  outline: "border-2 border-ustp-navy bg-transparent",
  danger: "bg-red-700",
};

const TEXT_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-ustp-text",
  outline: "text-ustp-navy",
  danger: "text-white",
};

const SPINNER_COLORS: Record<ButtonVariant, string> = {
  primary: UI_COLORS.white,
  secondary: USTP_COLORS.navy,
  outline: USTP_COLORS.navy,
  danger: UI_COLORS.white,
};

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  loadingTitle,
  disabled = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const label = loading && loadingTitle ? loadingTitle : title;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-5 py-3 active:opacity-80 ${CONTAINER_CLASSES[variant]} ${isDisabled ? "opacity-50" : ""}`}
    >
      {loading ? <ActivityIndicator color={SPINNER_COLORS[variant]} /> : null}
      <Text className={`text-base font-semibold ${TEXT_CLASSES[variant]}`}>
        {label}
      </Text>
    </Pressable>
  );
}
