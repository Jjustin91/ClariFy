import { apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { mockDelay } from "@/lib/mock-delay";
import { MOCK_CHANNELS } from "@/mocks";
import type { ApiListResponse, Channel } from "@/types/api";

/** GET /channels?type=course_hub. The real response is ASSUMED to be a paginated list. */
export async function fetchCourseHubs(): Promise<Channel[]> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return MOCK_CHANNELS;
  }
  const response = await apiRequest<ApiListResponse<Channel>>("/channels", {
    query: { type: "course_hub" },
  });
  return response.data;
}
