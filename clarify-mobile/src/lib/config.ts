// Settings read from the .env file (restart Expo with --clear after changing it).
// EXPO_PUBLIC_API_BASE_URL is from the playbook (§6). EXPO_PUBLIC_USE_MOCKS is our own
// assumption: it stays "true" until the Laravel backend is confirmed reachable.

export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

export const USE_MOCKS: boolean = process.env.EXPO_PUBLIC_USE_MOCKS !== "false";
