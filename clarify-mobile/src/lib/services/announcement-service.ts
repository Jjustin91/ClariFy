import { ApiError, apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { mockDelay } from "@/lib/mock-delay";
import { MOCK_ANNOUNCEMENTS } from "@/mocks";
import type {
  Announcement,
  AnnouncementQuery,
  ApiItemResponse,
  ApiListResponse,
  AuthUser,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  UserRole,
} from "@/types/api";

const PER_PAGE = 3;

// A copy, so acknowledging in mock mode does not change the original mock file.
// Mock acknowledgments are kept in memory only and reset when the app fully restarts.
const mockStore: Announcement[] = MOCK_ANNOUNCEMENTS.map((item) => ({
  ...item,
  read_reach: { ...item.read_reach },
}));

/** Pinned first, then newest first. */
function byPinnedThenNewest(a: Announcement, b: Announcement): number {
  if (a.is_pinned !== b.is_pinned) {
    return a.is_pinned ? -1 : 1;
  }
  return (
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
}

/**
 * GET /announcements (playbook §6.5).
 * `viewerRole` is only used by mock mode to imitate the server. In real mode the
 * server decides what each user may see from their token.
 */
export async function fetchAnnouncements(
  query: AnnouncementQuery,
  viewerRole: UserRole,
): Promise<ApiListResponse<Announcement>> {
  if (USE_MOCKS) {
    await mockDelay(600);

    // To test the error banner, temporarily remove the two slashes on the next line:
    // throw new ApiError('network', 'Cannot reach the server. Check your connection and try again.');

    const search = query.search?.trim().toLowerCase() ?? "";
    const matches = mockStore.filter((item) => {
      if (viewerRole === "student" && item.status !== "published") return false; // no drafts for students
      if (
        query.channel_id !== undefined &&
        item.channel_id !== query.channel_id
      )
        return false;
      if (query.tag && !item.tags.includes(query.tag)) return false;
      if (
        query.department &&
        !item.tags.includes(query.department) &&
        item.publisher.department !== query.department
      ) {
        return false;
      }
      if (
        search &&
        !`${item.title} ${item.content}`.toLowerCase().includes(search)
      )
        return false;
      return true;
    });

    const sorted = [...matches].sort(byPinnedThenNewest);
    const page = query.page ?? 1;
    const start = (page - 1) * PER_PAGE;

    return {
      data: sorted.slice(start, start + PER_PAGE),
      meta: {
        current_page: page,
        last_page: Math.max(1, Math.ceil(sorted.length / PER_PAGE)),
        per_page: PER_PAGE,
        total: sorted.length,
      },
    };
  }

  // The spread copies the query into a plain object that apiRequest accepts.
  return apiRequest<ApiListResponse<Announcement>>("/announcements", {
    query: { ...query },
  });
}

/**
 * POST /announcements/{id}/acknowledge (playbook §6.5).
 * The playbook does not show the response, so ASSUMED: { data: Announcement }.
 */
export async function acknowledgeAnnouncement(
  id: number,
): Promise<Announcement> {
  if (USE_MOCKS) {
    await mockDelay(400);

    const item = mockStore.find((announcement) => announcement.id === id);
    if (!item) {
      throw new ApiError("server", "Announcement not found.", 404);
    }
    if (!item.read_reach.has_current_user_acknowledged) {
      const count = item.read_reach.acknowledged_count + 1;
      item.read_reach = {
        ...item.read_reach,
        acknowledged_count: count,
        percentage:
          Math.round((count / item.read_reach.enrolled_total) * 1000) / 10,
        has_current_user_acknowledged: true,
      };
    }
    return { ...item };
  }

  const response = await apiRequest<ApiItemResponse<Announcement>>(
    `/announcements/${id}/acknowledge`,
    { method: "POST" },
  );
  return response.data;
}

// ───────────────────────── Faculty actions (Phase 4c) ─────────────────────────

/** Mock Course Hub that Aki is NOT assigned to (lets you test the playbook's 422 example). */
const MOCK_UNASSIGNED_CHANNEL_ID = 9;

// First message is the playbook's own 403 example (§6.3).
const FORBIDDEN_PUBLISH_MESSAGE =
  "Access Denied: Only authorized faculty assigned to this Course Hub can publish announcements.";
const FORBIDDEN_EDIT_MESSAGE =
  "Access Denied: You can only change notices you published.";

/** Builds the multipart body for POST /announcements (playbook §6.1). Attachment comes in step 2. */
function buildAnnouncementFormData(input: CreateAnnouncementInput): FormData {
  const formData = new FormData();
  formData.append("channel_id", String(input.channel_id));
  formData.append("title", input.title);
  formData.append("content", input.content);
  input.tags.forEach((tag) => formData.append("tags[]", tag));
  // "1" and "0" because Laravel's boolean rule rejects the text "true"/"false" in form data (ASSUMED).
  formData.append("is_urgent", input.is_urgent ? "1" : "0");
  formData.append(
    "trigger_sms_fallback",
    input.trigger_sms_fallback ? "1" : "0",
  );
  formData.append("status", input.status);
  return formData;
}

/** POST /announcements. Response shape follows the playbook sample: { message, data }. */
export async function createAnnouncement(
  input: CreateAnnouncementInput,
  author: AuthUser,
): Promise<ApiItemResponse<Announcement>> {
  if (USE_MOCKS) {
    await mockDelay(700);

    if (author.role !== "faculty") {
      throw new ApiError("forbidden", FORBIDDEN_PUBLISH_MESSAGE, 403);
    }

    const fieldErrors: Record<string, string[]> = {};
    if (!input.channel_id) {
      fieldErrors.channel_id = ["The channel id field is required."];
    } else if (input.channel_id === MOCK_UNASSIGNED_CHANNEL_ID) {
      fieldErrors.channel_id = [
        "You are not assigned to publish in this course hub.",
      ];
    }
    if (input.title.trim().length === 0) {
      fieldErrors.title = ["The title field is required."];
    }
    if (input.content.trim().length === 0) {
      fieldErrors.content = ["The content field is required."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        "validation",
        "Please check the highlighted fields.",
        422,
        fieldErrors,
      );
    }

    const now = new Date().toISOString();
    const created: Announcement = {
      id: Math.max(0, ...mockStore.map((item) => item.id)) + 1,
      channel_id: input.channel_id,
      title: input.title.trim(),
      content: input.content.trim(),
      attachment_url: null,
      tags: input.tags,
      is_urgent: input.is_urgent,
      is_pinned: input.is_urgent, // playbook: "Mark as Urgent (Pin + Push Alert)"
      status: input.status,
      is_edited: false,
      published_at: now,
      updated_at: now,
      read_reach: {
        acknowledged_count: 0,
        enrolled_total: 42,
        percentage: 0,
        has_current_user_acknowledged: false,
      },
      publisher: {
        id: author.id,
        name: author.name,
        role: author.role,
        department: author.academic_profile?.department ?? "",
      },
    };
    mockStore.unshift(created);

    return {
      message:
        input.status === "draft"
          ? "Draft saved."
          : "Announcement published and push alerts queued.",
      data: { ...created },
    };
  }

  return apiRequest<ApiItemResponse<Announcement>>("/announcements", {
    method: "POST",
    formData: buildAnnouncementFormData(input),
  });
}

/** PATCH /announcements/{id}. The server logs the audit entry and sets is_edited (NFR-03). */
export async function updateAnnouncement(
  id: number,
  input: UpdateAnnouncementInput,
  author: AuthUser,
): Promise<ApiItemResponse<Announcement>> {
  if (USE_MOCKS) {
    await mockDelay(600);

    const item = mockStore.find((announcement) => announcement.id === id);
    if (!item) {
      throw new ApiError("server", "Announcement not found.", 404);
    }
    if (author.role !== "faculty" || item.publisher.id !== author.id) {
      throw new ApiError("forbidden", FORBIDDEN_EDIT_MESSAGE, 403);
    }

    const fieldErrors: Record<string, string[]> = {};
    if (input.title !== undefined && input.title.trim().length === 0) {
      fieldErrors.title = ["The title field is required."];
    }
    if (input.content !== undefined && input.content.trim().length === 0) {
      fieldErrors.content = ["The content field is required."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        "validation",
        "Please check the highlighted fields.",
        422,
        fieldErrors,
      );
    }

    const wasDraft = item.status === "draft";

    if (input.title !== undefined) item.title = input.title.trim();
    if (input.content !== undefined) item.content = input.content.trim();
    if (input.is_urgent !== undefined) {
      item.is_urgent = input.is_urgent;
      item.is_pinned = input.is_urgent;
    }

    const isPublishingNow = wasDraft && input.status === "published";
    if (isPublishingNow) {
      item.status = "published";
      item.published_at = new Date().toISOString();
    }
    if (!wasDraft) {
      item.is_edited = true;
    }
    item.updated_at = new Date().toISOString();

    return {
      message: isPublishingNow
        ? "Announcement published and push alerts queued."
        : "Announcement updated.",
      data: { ...item },
    };
  }

  return apiRequest<ApiItemResponse<Announcement>>(`/announcements/${id}`, {
    method: "PATCH",
    body: input,
  });
}

/** DELETE /announcements/{id}. */
export async function deleteAnnouncement(
  id: number,
  author: AuthUser,
): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(500);

    const item = mockStore.find((announcement) => announcement.id === id);
    if (!item) {
      throw new ApiError("server", "Announcement not found.", 404);
    }
    if (author.role !== "faculty" || item.publisher.id !== author.id) {
      throw new ApiError("forbidden", FORBIDDEN_EDIT_MESSAGE, 403);
    }
    mockStore.splice(mockStore.indexOf(item), 1);
    return;
  }

  await apiRequest<unknown>(`/announcements/${id}`, { method: "DELETE" });
}
