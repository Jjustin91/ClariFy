import { Image, Text, View } from "react-native";

type AvatarSize = "md" | "lg";

const BOX_CLASSES: Record<AvatarSize, string> = {
  md: "h-14 w-14",
  lg: "h-28 w-28",
};

const TEXT_CLASSES: Record<AvatarSize, string> = {
  md: "text-lg",
  lg: "text-4xl",
};

/** "Dr. Ramon Villanueva" becomes "RV". Words ending in a period (titles) are skipped. */
function getInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word.length > 0 && !word.endsWith("."));
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
  return initials.length > 0 ? initials : "?";
}

interface AvatarProps {
  name: string;
  /** Profile picture address. Without one, the initials are shown. */
  uri?: string | null;
  size?: AvatarSize;
}

export function Avatar({ name, uri, size = "md" }: AvatarProps) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={`${name} profile picture`}
        className={`${BOX_CLASSES[size]} rounded-full bg-gray-200`}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`${name} initials`}
      className={`${BOX_CLASSES[size]} items-center justify-center rounded-full bg-ustp-navy`}
    >
      <Text className={`${TEXT_CLASSES[size]} font-bold text-ustp-gold`}>
        {getInitials(name)}
      </Text>
    </View>
  );
}
