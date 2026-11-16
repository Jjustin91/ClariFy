import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { ANONYMOUS_STUDENT_LABEL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import type { Thread } from "@/types/api";

interface QaThreadCardProps {
  thread: Thread;
  defaultExpanded?: boolean;
  /** Extra controls shown when expanded (student edit/delete, faculty reply) in later steps. */
  children?: ReactNode;
}

export function QaThreadCard({
  thread,
  defaultExpanded = false,
  children,
}: QaThreadCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Never show a student's name on a public FAQ item (playbook FR-07).
  const authorName = thread.is_pinned_faq
    ? ANONYMOUS_STUDENT_LABEL
    : thread.author_name;

  return (
    <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        className="min-h-12 gap-2 p-4 active:opacity-80"
      >
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 text-lg font-bold text-ustp-navy">
            {thread.subject_hashtag}
          </Text>
          <Text className="text-sm font-semibold text-ustp-blue">
            {expanded ? "Hide" : "Show"}
          </Text>
        </View>
        <Text className="text-xs text-gray-600">
          {authorName} · {formatDateTime(thread.created_at)}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {thread.status === "resolved" ? (
            <Badge label="RESOLVED" variant="success" />
          ) : null}
          {thread.is_pinned_faq ? (
            <Badge label="Pinned to Class FAQs" variant="tag" />
          ) : null}
          {thread.is_private ? <Badge label="PRIVATE" /> : null}
        </View>
      </Pressable>

      {expanded ? (
        <View className="gap-3 border-t border-gray-200 p-4">
          <Text className="text-base text-ustp-text">{thread.content}</Text>

          {thread.reply ? (
            <View className="gap-1 rounded-xl border-l-4 border-ustp-gold bg-ustp-cream p-3">
              <Text className="text-xs font-semibold text-ustp-navy">
                Reply from {thread.reply.author_name} ·{" "}
                {formatDateTime(thread.reply.created_at)}
              </Text>
              <Text className="text-base text-ustp-text">
                {thread.reply.content}
              </Text>
            </View>
          ) : (
            <Text className="text-sm italic text-gray-600">
              Waiting for an instructor reply.
            </Text>
          )}

          {children}
        </View>
      ) : null}
    </View>
  );
}
