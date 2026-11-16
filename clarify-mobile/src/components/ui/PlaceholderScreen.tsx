import { ScrollView, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface PlaceholderScreenProps {
  title: string;
  description: string;
  /** Which roadmap phase builds the real screen, e.g. "Phase 4b". */
  builtIn: string;
}

export function PlaceholderScreen({
  title,
  description,
  builtIn,
}: PlaceholderScreenProps) {
  return (
    <ScrollView
      className="flex-1 bg-ustp-cream"
      contentContainerStyle={{ padding: 24, gap: 16 }}
    >
      <View>
        <Badge label="PLACEHOLDER SCREEN" variant="urgent" />
      </View>
      <EmptyState
        title={title}
        message={`${description}\n\nBuilt in ${builtIn}.`}
      />
    </ScrollView>
  );
}
