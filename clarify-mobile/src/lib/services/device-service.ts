import { apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { mockDelay } from "@/lib/mock-delay";
import type { DeviceTokenRequest } from "@/types/api";

/** POST /devices/token (playbook NFR-02). The response is not documented, so none is read. */
export async function registerDeviceToken(
  request: DeviceTokenRequest,
): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return;
  }
  await apiRequest<unknown>("/devices/token", {
    method: "POST",
    body: request,
  });
}
