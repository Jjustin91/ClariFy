import { Alert, Linking, Pressable, Text, View } from "react-native";

import type { BadgeVariant } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DEPARTMENTS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import type { Announcement } from "@/types/api";

interface AnnouncementCardProps {
  announcement: Announcement;
  /** True for students only. The backend still enforces who may acknowledge. */
  canAcknowledge: boolean;
  isAcknowledging: boolean;
  onAcknowledge: (id: number) => void;
  /** Passed only to faculty for notices they published. Students never receive these. */
  onEdit?: (announcement: Announcement) => void;
  onDelete?: (announcement: Announcement) => void;
  isDeleting?: boolean;
}

function tagVariant(tag: string): BadgeVariant {
  if (tag === "URGENT NOTICE") return "urgent";
  if ((DEPARTMENTS as readonly string[]).includes(tag)) return "department";
  return "tag";
}

async function openAttachment(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      "Cannot open attachment",
      "The file could not be opened. Please try again later.",
    );
  }
}

export function AnnouncementCard({
  announcement,
  canAcknowledge,
  isAcknowledging,
  onAcknowledge,
  onEdit,
  onDelete,
  isDeleting = false,
}: AnnouncementCardProps) {
  const { read_reach: reach, publisher } = announcement;
  const attachmentName = announcement.attachment_url
    ? decodeURIComponent(
        announcement.attachment_url.split("/").pop() ?? "Attachment",
      )
    : null;

  return (
    <View
      className={`gap-3 rounded-2xl bg-white p-4 ${announcement.is_urgent ? "border-l-4 border-ustp-orange" : "border border-gray-200"}`}
    >
      <View className="flex-row flex-wrap gap-2">
        {announcement.status === "draft" ? <Badge label="DRAFT" /> : null}
        {announcement.is_pinned ? <Badge label="PINNED" /> : null}
        {announcement.tags.map((tag) => (
          <Badge key={tag} label={tag} variant={tagVariant(tag)} />
        ))}
      </View>

      <Text className="text-lg font-bold text-ustp-navy">
        {announcement.title}
      </Text>
      <Text className="text-base text-ustp-text">{announcement.content}</Text>

      {attachmentName && announcement.attachment_url ? (
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            void openAttachment(announcement.attachment_url as string)
          }
          className="min-h-12 justify-center rounded-xl border border-ustp-blue px-4 py-2 active:opacity-70"
        >
          <Text className="text-sm font-semibold text-ustp-blue">
            Attachment: {attachmentName}
          </Text>
        </Pressable>
      ) : null}

      <View className="gap-1">
        <Text className="text-xs text-gray-600">
          Published {formatDateTime(announcement.published_at)} by{" "}
          {publisher.name}
        </Text>
        {announcement.is_edited ? (
          <Text className="text-xs font-semibold text-gray-600">
            (Edited) updated {formatDateTime(announcement.updated_at)}
          </Text>
        ) : null}
      </View>

      <View className="gap-1">
        <Text className="text-sm font-semibold text-ustp-text">
          Read {reach.acknowledged_count}/{reach.enrolled_total} (
          {reach.percentage}%)
        </Text>
        <View className="h-2 overflow-hidden rounded-full bg-gray-200">
          <View
            className="h-2 bg-ustp-gold"
            style={{ width: `${Math.min(100, reach.percentage)}%` }}
          />
        </View>
      </View>

      {canAcknowledge ? (
        reach.has_current_user_acknowledged ? (
          <Badge label="ACKNOWLEDGED" variant="success" />
        ) : (
          <Button
            title="Mark as Read / Acknowledge"
            loadingTitle="Saving..."
            variant="secondary"
            loading={isAcknowledging}
            onPress={() => onAcknowledge(announcement.id)}
          />
        )
      ) : null}

      {onEdit || onDelete ? (
        <View className="flex-row gap-3">
          {onEdit ? (
            <View className="flex-1">
              <Button
                title="Edit"
                variant="outline"
                disabled={isDeleting}
                onPress={() => onEdit(announcement)}
              />
            </View>
          ) : null}
          {onDelete ? (
            <View className="flex-1">
              <Button
                title="Delete"
                loadingTitle="Deleting..."
                variant="danger"
                loading={isDeleting}
                onPress={() => onDelete(announcement)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
