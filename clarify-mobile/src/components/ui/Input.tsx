import type { TextInputProps } from "react-native";
import { Text, TextInput, View } from "react-native";

import { UI_COLORS } from "@/lib/constants";

interface InputProps extends TextInputProps {
  label: string;
  /** Field error message, e.g. the first item of errors.title from a 422 response. */
  error?: string;
}

export function Input({ label, error, ...inputProps }: InputProps) {
  const hasError = Boolean(error);

  return (
    <View className="gap-1">
      <Text className="text-sm font-semibold text-ustp-text">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={UI_COLORS.placeholder}
        className={`min-h-12 rounded-xl border-2 bg-white px-4 py-3 text-base text-ustp-text ${hasError ? "border-red-600" : "border-gray-300"}`}
        {...inputProps}
      />
      {hasError ? (
        <Text accessibilityRole="alert" className="text-sm text-red-700">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
