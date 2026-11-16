// MOCK DATA: fake instructors. NOT from the real backend.
// Campus values are ASSUMED. Only Aki Hayakawa's id comes from the playbook sample.

import type { Instructor } from "@/types/api";

export const MOCK_INSTRUCTORS: Instructor[] = [
  {
    id: 10492,
    name: "Aki Hayakawa",
    avatar_url: null,
    campus: "USTP CDO",
    department: "CITC",
  },
  {
    id: 10493,
    name: "Maria Lourdes Reyes",
    avatar_url: null,
    campus: "USTP CDO",
    department: "CITC",
  },
  {
    id: 10501,
    name: "Engr. Paolo Navarro",
    avatar_url: null,
    campus: "USTP CDO",
    department: "CEA",
  },
  {
    id: 10514,
    name: "Prof. Angela Cruz",
    avatar_url: null,
    campus: "USTP CDO",
    department: "COT",
  },
  {
    id: 10522,
    name: "Dr. Ramon Villanueva",
    avatar_url: null,
    campus: "USTP CDO",
    department: "CSM",
  },
  {
    id: 10530,
    name: "Jessa Mae Tan",
    avatar_url: null,
    campus: "USTP CDO",
    department: "CITC",
  },
];
