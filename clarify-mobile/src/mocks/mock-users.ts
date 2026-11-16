// MOCK DATA: fake users for developing the UI. NOT from the real backend.
// Names follow the MVP demo roles in the playbook (Student: Kobeni, Faculty: Aki).

import type { AuthUser } from "@/types/api";

export const MOCK_STUDENT: AuthUser = {
  id: 20201,
  name: "Kobeni Higashiyama",
  role: "student",
  academic_profile: {
    college: "CITC",
    department: "CITC",
    program: "BSIT",
    year_level: "3rd Year",
  },
  contact_number: "09171234567",
  avatar_url: null,
};

export const MOCK_FACULTY: AuthUser = {
  id: 10492,
  name: "Aki Hayakawa",
  role: "faculty",
  academic_profile: {
    college: "CITC",
    department: "CITC",
    program: null,
    year_level: null,
  },
  contact_number: "09181234567",
  avatar_url: null,
};

/** Invented account, only used to test what a non-mobile role sees. */
export const MOCK_DEPT_HEAD: AuthUser = {
  id: 10600,
  name: "Elena Marquez",
  role: "dept_head",
  academic_profile: {
    college: "CITC",
    department: "CITC",
    program: null,
    year_level: null,
  },
  contact_number: "09191234567",
  avatar_url: null,
};

/** Fake login accounts for the mock login. Never use real credentials here. */
export const MOCK_LOGIN_ACCOUNTS: ReadonlyArray<{
  institutional_id: string;
  password: string;
  user: AuthUser;
}> = [
  {
    institutional_id: "2020202020",
    password: "mock-password",
    user: MOCK_STUDENT,
  },
  {
    institutional_id: "1010101010",
    password: "mock-password",
    user: MOCK_FACULTY,
  },
  {
    institutional_id: "3030303030",
    password: "mock-password",
    user: MOCK_DEPT_HEAD,
  },
];
