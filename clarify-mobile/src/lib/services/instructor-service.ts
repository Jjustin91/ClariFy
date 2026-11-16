import { apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { mockDelay } from "@/lib/mock-delay";
import { MOCK_INSTRUCTORS } from "@/mocks";
import type { ApiListResponse, Instructor, InstructorQuery } from "@/types/api";

const PER_PAGE = 10;

/**
 * GET /instructors (playbook: ?search=&department=CITC&sort=name&page=1).
 * Mock mode imitates the server: filters, sorts by name, and paginates.
 */
export async function fetchInstructors(
  query: InstructorQuery,
): Promise<ApiListResponse<Instructor>> {
  if (USE_MOCKS) {
    await mockDelay(500);

    const search = query.search?.trim().toLowerCase() ?? "";
    const matches = MOCK_INSTRUCTORS.filter(
      (person) =>
        (!query.department || person.department === query.department) &&
        (search === "" || person.name.toLowerCase().includes(search)),
    );
    const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name));

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

  // "name" is the only sort value the playbook documents.
  return apiRequest<ApiListResponse<Instructor>>("/instructors", {
    query: { ...query, sort: query.sort ?? "name" },
  });
}
