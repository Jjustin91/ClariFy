/** Pretends the network takes a moment (mock mode only). */
export const mockDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
