import { Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ANNOUNCEMENT_TAGS, DEPARTMENTS } from "@/lib/constants";

interface AnnouncementFilterBarProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  selectedTag: string | undefined;
  onTagChange: (tag: string | undefined) => void;
  selectedDepartment: string | undefined;
  onDepartmentChange: (department: string | undefined) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-full border-2 px-4 active:opacity-80 ${selected ? "border-ustp-navy bg-ustp-navy" : "border-gray-300 bg-white"}`}
    >
      <Text
        className={`text-sm font-semibold ${selected ? "text-white" : "text-ustp-text"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AnnouncementFilterBar({
  searchText,
  onSearchTextChange,
  selectedTag,
  onTagChange,
  selectedDepartment,
  onDepartmentChange,
  hasActiveFilters,
  onClear,
}: AnnouncementFilterBarProps) {
  return (
    <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <Input
        label="Search"
        placeholder="Keyword or course code, e.g. ES211a"
        value={searchText}
        onChangeText={onSearchTextChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      <View className="gap-2">
        <Text className="text-sm font-semibold text-ustp-text">Tags</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {ANNOUNCEMENT_TAGS.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              selected={selectedTag === tag}
              onPress={() => onTagChange(selectedTag === tag ? undefined : tag)}
            />
          ))}
        </ScrollView>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-semibold text-ustp-text">Department</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {DEPARTMENTS.map((department) => (
            <Chip
              key={department}
              label={department}
              selected={selectedDepartment === department}
              onPress={() =>
                onDepartmentChange(
                  selectedDepartment === department ? undefined : department,
                )
              }
            />
          ))}
        </ScrollView>
      </View>

      {hasActiveFilters ? (
        <Button title="Clear filters" variant="outline" onPress={onClear} />
      ) : null}
    </View>
  );
}
