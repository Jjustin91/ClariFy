import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { SuccessBanner } from "@/components/ui/SuccessBanner";
import { useAuthSession } from "@/hooks/useAuthSession";
import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { updateProfile } from "@/lib/services/profile-service";
import { MOCK_DATA_NOTICE } from "@/mocks";
import type { PickedFile } from "@/types/api";

export default function SettingsScreen() {
  const { user, updateUser } = useAuthSession();
  const [contactNumber, setContactNumber] = useState(
    user?.contact_number ?? "",
  );
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // This route is protected, so a user always exists here. The check keeps TypeScript satisfied.
  if (!user) {
    return null;
  }

  const profile = user.academic_profile;
  const avatarUri = picked?.uri ?? user.avatar_url ?? null;
  const hasFieldErrors =
    error !== null && Object.keys(error.fieldErrors).length > 0;
  const showBanner = error !== null && !hasFieldErrors;
  const canRetry =
    error !== null && (error.kind === "network" || error.kind === "server");

  async function pickPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      setPicked({
        uri: asset.uri,
        name: asset.fileName ?? `avatar-${Date.now()}.jpg`,
        mime_type: asset.mimeType ?? "image/jpeg",
      });
      setSuccessMessage(null);
    } catch {
      Alert.alert(
        "Cannot open photos",
        "The photo library could not be opened. Please try again.",
      );
    }
  }

  async function handleSave() {
    if (!user) return;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await updateProfile(
        { contact_number: contactNumber, avatar: picked ?? undefined },
        user,
      );
      updateUser(result.data);
      setContactNumber(result.data.contact_number ?? "");
      setPicked(null);
      setSuccessMessage(result.message ?? "Profile updated.");
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-ustp-cream"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {USE_MOCKS ? <Badge label={MOCK_DATA_NOTICE} variant="urgent" /> : null}

      <View className="items-center gap-3 rounded-2xl border border-gray-200 bg-white p-6">
        <Avatar name={user.name} uri={avatarUri} size="lg" />
        <Text className="text-xl font-bold text-ustp-navy">{user.name}</Text>
        <Badge
          label={user.role === "faculty" ? "FACULTY" : "STUDENT"}
          variant={user.role === "faculty" ? "tag" : "department"}
        />
        {profile ? (
          <View className="items-center gap-1">
            {profile.college ? (
              <Text className="text-sm text-ustp-text">
                College: {profile.college}
              </Text>
            ) : null}
            {profile.program ? (
              <Text className="text-sm text-ustp-text">
                Program: {profile.program}
              </Text>
            ) : null}
            {profile.year_level ? (
              <Text className="text-sm text-ustp-text">
                Year level: {profile.year_level}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      {showBanner && error ? (
        <ErrorBanner
          title={
            error.kind === "forbidden" ? "Access Denied" : "Could not save"
          }
          message={error.message}
          onRetry={canRetry ? () => void handleSave() : undefined}
        />
      ) : null}

      <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="text-lg font-semibold text-ustp-navy">
          Profile picture
        </Text>
        <Button
          title={picked ? "Choose a different photo" : "Choose a photo"}
          variant="outline"
          disabled={isSaving}
          onPress={() => void pickPhoto()}
        />
        {picked ? (
          <Text className="text-sm text-ustp-text">
            New photo selected. Tap Save changes to upload it.
          </Text>
        ) : null}
        {error?.firstError("avatar") ? (
          <Text className="text-sm text-red-700">
            {error.firstError("avatar")}
          </Text>
        ) : null}
      </View>

      <View className="gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Input
          label="Mobile contact number"
          placeholder="e.g. 09171234567"
          value={contactNumber}
          onChangeText={setContactNumber}
          keyboardType="phone-pad"
          autoCorrect={false}
          error={error?.firstError("contact_number")}
        />
        <Text className="text-sm text-gray-600">
          Used for SMS alerts when urgent notices need a low-bandwidth fallback.
        </Text>
      </View>

      <Button
        title="Save changes"
        loadingTitle="Saving..."
        loading={isSaving}
        onPress={() => void handleSave()}
      />
    </ScrollView>
  );
}
