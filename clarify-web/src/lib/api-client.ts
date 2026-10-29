const notWired = async (): Promise<unknown> => {
  throw new Error('api-client not wired yet');
};

export const apiClient = {
  get: (_path: string, _opts?: unknown) => notWired(),
  post: (_path: string, _body?: unknown) => notWired(),
  patch: (_path: string, _body?: unknown) => notWired(),
  delete: (_path: string) => notWired(),
};