import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { Chip } from "@/components/announcements/AnnouncementFilterBar";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { ANNOUNCEMENT_TAGS, DEPARTMENTS, USTP_COLORS } from "@/lib/constants";
import {
  createAnnouncement,
  updateAnnouncement,
} from "@/lib/services/announcement-service";
import { fetchCourseHubs } from "@/lib/services/channel-service";
import type { Announcement, AuthUser, Channel } from "@/types/api";

interface AnnouncementFormModalProps {
  visible: boolean;
  /** null = create a new notice; an Announcement = edit that notice. */
  editing: Announcement | null;
  author: AuthUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const TAG_CHOICES: string[] = [...ANNOUNCEMENT_TAGS, ...DEPARTMENTS];

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <Text className="text-sm text-red-700">{message}</Text>
  ) : null;
}

interface SwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

export function SwitchRow({ label, value, onValueChange }: SwitchRowProps) {
  return (
    <View className="min-h-12 flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-base text-ustp-text">{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: USTP_COLORS.navy }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function AnnouncementFormModal({
  visible,
  editing,
  author,
  onClose,
  onSaved,
}: AnnouncementFormModalProps) {
  const isEditing = editing !== null;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsError, setChannelsError] = useState<ApiError | null>(null);
  const [channelsReload, setChannelsReload] = useState(0);

  const [channelId, setChannelId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isUrgent, setIsUrgent] = useState(false);
  const [triggerSms, setTriggerSms] = useState(false);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [publishNow, setPublishNow] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Fill the form each time it opens.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIsSubmitting(false);
    setPublishNow(false);
    if (editing) {
      setTitle(editing.title);
      setContent(editing.content);
      setIsUrgent(editing.is_urgent);
    } else {
      setChannelId(null);
      setTitle("");
      setContent("");
      setTags([]);
      setIsUrgent(false);
      setTriggerSms(false);
      setSaveAsDraft(false);
    }
  }, [visible, editing]);

  // Load the Course Hub choices (create mode only).
  useEffect(() => {
    if (!visible || editing) return;
    let cancelled = false;
    setChannelsError(null);
    fetchCourseHubs()
      .then((list) => {
        if (!cancelled) setChannels(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setChannelsError(toApiError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, editing, channelsReload]);

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag],
    );
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    try {
      if (editing) {
        const result = await updateAnnouncement(
          editing.id,
          {
            title,
            content,
            is_urgent: isUrgent,
            status: publishNow ? "published" : undefined,
          },
          author,
        );
        onSaved(result.message ?? "Announcement updated.");
      } else {
        const result = await createAnnouncement(
          {
            channel_id: channelId ?? 0, // 0 = nothing chosen; the server answers with a 422
            title,
            content,
            tags,
            is_urgent: isUrgent,
            trigger_sms_fallback: triggerSms,
            status: saveAsDraft ? "draft" : "published",
          },
          author,
        );
        onSaved(result.message ?? "Announcement saved.");
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

  const isPublishingDraft =
    isEditing && editing?.status === "draft" && publishNow;
  const submitTitle = isPublishingDraft
    ? "Publish"
    : isEditing
      ? "Save changes"
      : saveAsDraft
        ? "Save draft"
        : "Publish";
  const submitLoadingTitle =
    isPublishingDraft || (!isEditing && !saveAsDraft)
      ? "Publishing..."
      : "Saving...";

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
            {isEditing ? "Edit Notice" : "Create Notice"}
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

        {isEditing ? (
          <Text className="text-sm text-ustp-text">
            You can change the title, content, and urgent status. Edits are
            recorded and the notice shows an (Edited) badge.
          </Text>
        ) : null}

        {showBanner && error ? (
          <ErrorBanner
            title={
              error.kind === "forbidden" ? "Access Denied" : "Could not save"
            }
            message={error.message}
            onRetry={canRetry ? () => void handleSubmit() : undefined}
          />
        ) : null}

        {!isEditing ? (
          <View className="gap-2">
            <Text className="text-sm font-semibold text-ustp-text">
              Course Hub
            </Text>
            {channelsError ? (
              <ErrorBanner
                message={channelsError.message}
                onRetry={() => setChannelsReload((count) => count + 1)}
              />
            ) : channels.length === 0 ? (
              <Text className="text-sm text-gray-600">
                Loading Course Hubs...
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {channels.map((channel) => (
                  <Chip
                    key={channel.id}
                    label={channel.name}
                    selected={channelId === channel.id}
                    onPress={() => setChannelId(channel.id)}
                  />
                ))}
              </View>
            )}
            <FieldError message={error?.firstError("channel_id")} />
          </View>
        ) : null}

        <Input
          label="Title"
          placeholder="Notice title"
          value={title}
          onChangeText={setTitle}
          error={error?.firstError("title")}
        />
        <Input
          label="Content"
          placeholder="Write the notice"
          value={content}
          onChangeText={setContent}
          multiline
          style={{ minHeight: 120, textAlignVertical: "top" }}
          error={error?.firstError("content")}
        />

        {!isEditing ? (
          <View className="gap-2">
            <Text className="text-sm font-semibold text-ustp-text">Tags</Text>
            <View className="flex-row flex-wrap gap-2">
              {TAG_CHOICES.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  selected={tags.includes(tag)}
                  onPress={() => toggleTag(tag)}
                />
              ))}
            </View>
            <FieldError message={error?.firstError("tags")} />
          </View>
        ) : null}

        <View>
          <SwitchRow
            label="Mark as Urgent (Pin + Push Alert)"
            value={isUrgent}
            onValueChange={setIsUrgent}
          />
          {isEditing && editing?.status === "draft" ? (
            <SwitchRow
              label="Publish this draft now"
              value={publishNow}
              onValueChange={setPublishNow}
            />
          ) : null}
          {!isEditing ? (
            <>
              <SwitchRow
                label="Trigger Offline SMS Fallback"
                value={triggerSms}
                onValueChange={setTriggerSms}
              />
              <SwitchRow
                label="Save as Draft"
                value={saveAsDraft}
                onValueChange={setSaveAsDraft}
              />
            </>
          ) : null}
        </View>

        <Button
          title={submitTitle}
          loadingTitle={submitLoadingTitle}
          loading={isSubmitting}
          onPress={() => void handleSubmit()}
        />
      </ScrollView>
    </Modal>
  );
}
