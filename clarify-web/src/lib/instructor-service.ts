import { mockInstructors } from '@/mocks/instructors';
import type { InstructorDirectoryEntry, InstructorFilters, Paginated } from '@/types/api';

const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listInstructors(filters: InstructorFilters): Promise<Paginated<InstructorDirectoryEntry>> {
  await wait();
  let instructors = [...mockInstructors];
  if (filters.search) {
    const search = filters.search.trim().toLowerCase();
    instructors = instructors.filter(
      (instructor) =>
        instructor.name.toLowerCase().includes(search) ||
        instructor.department.toLowerCase().includes(search) ||
        instructor.campus.toLowerCase().includes(search)
    );
  }
  if (filters.department) {
    instructors = instructors.filter((instructor) => instructor.department === filters.department);
  }
  instructors.sort((first, second) => first.name.localeCompare(second.name));
  const perPage = 4;
  const page = Math.max(1, filters.page ?? 1);
  const start = (page - 1) * perPage;
  return {
    data: instructors.slice(start, start + perPage),
    meta: {
      current_page: page,
      last_page: Math.max(1, Math.ceil(instructors.length / perPage)),
      per_page: perPage,
      total: instructors.length,
    },
  };
}
