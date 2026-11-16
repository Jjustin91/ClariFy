// src/lib/constants.ts
// Fixed values taken from the playbook (§1.1 FR-05, §5.1).

import type { UserRole } from "@/types/api";

export const USER_ROLES = {
  student: "student",
  faculty: "faculty",
  deptHead: "dept_head",
  itAdmin: "it_admin",
} as const satisfies Record<string, UserRole>;

/** Announcement tags named in FR-05. */
export const ANNOUNCEMENT_TAGS = [
  "URGENT NOTICE",
  "OFFICIAL MEMO",
  "CDO CAMPUS",
  "MEMORANDUM",
] as const;

/** Department filters named in FR-05. */
export const DEPARTMENTS = ["CITC", "CEA", "COT", "CSM"] as const;

/** Shown instead of a student's name on public FAQ items (FR-07). */
export const ANONYMOUS_STUDENT_LABEL = "Anonymous Student";

/** Convenience checks used to show or hide controls. The backend still enforces permissions. */
export const isStudent = (role: UserRole): boolean => role === "student";
export const isFaculty = (role: UserRole): boolean => role === "faculty";

/**
 * Hex values for props that cannot use a className (spinner color, placeholder color).
 * Keep these in sync with the tokens in src/global.css.
 */
export const USTP_COLORS = {
  navy: "#1a1851",
  gold: "#fcb315",
  orange: "#ff9718",
  cream: "#FFFAF2",
  text: "#031c2e",
  blue: "#0d4a77",
  sky: "#329dea",
} as const;

/** Neutral colors used by shared components (assumption: not defined in the playbook). */
export const UI_COLORS = {
  white: "#ffffff",
  placeholder: "#6b7280",
} as const;
