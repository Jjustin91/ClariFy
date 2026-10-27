// Single source of truth for API TypeScript interfaces (snake_case matching Laravel 13 Resources)

export interface ApiResponse<T> {
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

// TODO: Add User, Channel, Announcement, Thread, and Admin interfaces per Section 6
