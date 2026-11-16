import { useEffect, useState } from "react";
import { Animated, View } from "react-native";

interface SkeletonProps {
  /** Size and shape classes, e.g. "h-4 w-40 rounded". Defaults to a full-width text line. */
  className?: string;
}

export function Skeleton({ className = "h-4 w-full rounded" }: SkeletonProps) {
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }} accessibilityElementsHidden>
      <View className={`bg-gray-300 ${className}`} />
    </Animated.View>
  );
}
