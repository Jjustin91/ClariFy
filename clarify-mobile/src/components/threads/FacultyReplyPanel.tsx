import { useState } from "react";
import { Alert, View } from "react-native";

import { SwitchRow } from "@/components/announcements/AnnouncementFormModal";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import {
    convertThreadToFaq,
    replyToThread,
} from "@/lib/services/thread-service";
import type { AuthUser, Thread } from "@/types/api";

interface FacultyReplyPanelProps {
  thread: Thread;
  author: AuthUser;
  /** Called after a successful reply or publish, so the list can reload. */
  onChanged: (message: string) => void;
}

export function FacultyReplyPanel({
  thread,
  author,
  onChanged,
}: FacultyReplyPanelProps) {
  const [content, setContent] = useState("");
  const [markResolved, setMarkResolved] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Already published: nothing more to do here.
  if (thread.is_pinned_faq) {
    return null;
  }

  const busy = isReplying || isPublishing;
  const hasFieldErrors =
    error !== null && Object.keys(error.fieldErrors).length > 0;
  const showBanner = error !== null && !hasFieldErrors;

  async function handleReply() {
    setIsReplying(true);
    setError(null);
    try {
      const result = await replyToThread(
        thread.id,
        { content, mark_resolved: markResolved, pin_to_faq: false },
        author,
      );
      setContent("");
      setMarkResolved(false);
      onChanged(result.message ?? "Reply sent.");
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setIsReplying(false);
    }
  }

  async function runPublish() {
    setIsPublishing(true);
    setError(null);
    try {
      const result = await convertThreadToFaq(thread.id, author);
      onChanged(result.message ?? "Published to Class FAQs.");
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setIsPublishing(false);
    }
  }

  function handlePublishPress() {
    if (thread.is_private) {
      Alert.alert(
        "Publish a private inquiry?",
        "This question and your reply will become visible to everyone in this Course Hub. The student will be shown as Anonymous Student.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Publish", onPress: () => void runPublish() },
        ],
      );
    } else {
      void runPublish();
    }
  }

  return (
    <View className="gap-3 border-t border-gray-200 pt-3">
      {showBanner && error ? (
        <ErrorBanner
          title={
            error.kind === "forbidden" ? "Access Denied" : "Could not save"
          }
          message={error.message}
        />
      ) : null}

      {thread.status === "open" ? (
        <>
          <Input
            label={thread.reply ? "Update reply" : "Your reply"}
            placeholder="Write a reply"
            value={content}
            onChangeText={setContent}
            multiline
            style={{ minHeight: 90, textAlignVertical: "top" }}
            error={error?.firstError("content")}
          />
          <SwitchRow
            label="Mark as Resolved"
            value={markResolved}
            onValueChange={setMarkResolved}
          />
          <Button
            title="Send reply"
            loadingTitle="Sending..."
            loading={isReplying}
            disabled={isPublishing}
            onPress={() => void handleReply()}
          />
        </>
      ) : null}

      {thread.status === "resolved" ? (
        <Button
          title="Publish to Class FAQ"
          loadingTitle="Publishing..."
          variant="secondary"
          loading={isPublishing}
          disabled={busy}
          onPress={handlePublishPress}
        />
      ) : null}
    </View>
  );
}
