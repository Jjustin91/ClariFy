import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { SwitchRow } from "@/components/announcements/AnnouncementFormModal";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { createThread, updateThread } from "@/lib/services/thread-service";
import type { AuthUser, Thread } from "@/types/api";

interface InquiryFormModalProps {
  visible: boolean;
  channelId: number;
  /** null = ask a new question; a Thread = edit that question. */
  editing: Thread | null;
  author: AuthUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** "grade consultation" becomes "#grade_consultation". ASSUMED convention, taken from the mock examples. */
function normalizeHashtag(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, "_");
  if (cleaned.length === 0) return "";
  return cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
}

export function InquiryFormModal({
  visible,
  channelId,
  editing,
  author,
  onClose,
  onSaved,
}: InquiryFormModalProps) {
  const isEditing = editing !== null;

  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Fill the form each time it opens.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIsSubmitting(false);
    setSubject("");
    setIsPrivate(false);
    setContent(editing ? editing.content : "");
  }, [visible, editing]);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    try {
      if (editing) {
        const result = await updateThread(editing.id, { content }, author);
        onSaved(result.message ?? "Inquiry updated.");
      } else {
        const result = await createThread(
          channelId,
          {
            announcement_id: null,
            subject_hashtag: normalizeHashtag(subject),
            content,
            is_private: isPrivate,
          },
          author,
        );
        onSaved(result.message ?? "Inquiry submitted.");
      }
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasFieldErrors =
    error !== null && Object.keys(error.fieldErrors).length > 0;
  const showBanner = error !== null && !hasFieldErrors;
  const canRetry =
    error !== null && (error.kind === "network" || error.kind === "server");

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView
        className="flex-1 bg-ustp-cream"
        contentContainerStyle={{ padding: 20, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-ustp-navy">
            {isEditing ? "Edit Question" : "Ask a Question"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            disabled={isSubmitting}
            className="min-h-12 justify-center px-2 active:opacity-70"
          >
            <Text className="text-base font-semibold text-ustp-blue">
              Close
            </Text>
          </Pressable>
        </View>

        {showBanner && error ? (
          <ErrorBanner
            title={
              error.kind === "forbidden" ? "Access Denied" : "Could not save"
            }
            message={error.message}
            onRetry={canRetry ? () => void handleSubmit() : undefined}
          />
        ) : null}

        {isEditing && editing ? (
          <Text className="text-base font-semibold text-ustp-navy">
            Subject: {editing.subject_hashtag}
          </Text>
        ) : (
          <Input
            label="Subject hashtag"
            placeholder="e.g. #Defence or grade consultation"
            value={subject}
            onChangeText={setSubject}
            autoCapitalize="none"
            autoCorrect={false}
            error={error?.firstError("subject_hashtag")}
          />
        )}

        <Input
          label="Your question"
          placeholder="Write your question"
          value={content}
          onChangeText={setContent}
          multiline
          style={{ minHeight: 120, textAlignVertical: "top" }}
          error={error?.firstError("content")}
        />

        {!isEditing ? (
          <SwitchRow
            label="Make Inquiry Private (Visible only to Instructor)"
            value={isPrivate}
            onValueChange={setIsPrivate}
          />
        ) : null}

        <Button
          title={isEditing ? "Save changes" : "Submit Question"}
          loadingTitle={isEditing ? "Saving..." : "Submitting..."}
          loading={isSubmitting}
          onPress={() => void handleSubmit()}
        />
      </ScrollView>
    </Modal>
  );
}
