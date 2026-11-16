import { ApiError, apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { mockDelay } from "@/lib/mock-delay";
import type {
    ApiItemResponse,
    AuthUser,
    UpdateProfileInput,
} from "@/types/api";

/** ASSUMED format: 11 digits starting with 09. The real backend decides what is valid. */
const MOBILE_NUMBER_PATTERN = /^09\d{9}$/;

/** POST /profile with _method PATCH. Real response shape is ASSUMED: { message?, data: AuthUser }. */
export async function updateProfile(
  input: UpdateProfileInput,
  current: AuthUser,
): Promise<ApiItemResponse<AuthUser>> {
  if (USE_MOCKS) {
    await mockDelay(700);

    const number = input.contact_number.trim();
    if (number.length === 0) {
      throw new ApiError(
        "validation",
        "Please check the highlighted fields.",
        422,
        {
          contact_number: ["The contact number field is required."],
        },
      );
    }
    if (!MOBILE_NUMBER_PATTERN.test(number)) {
      throw new ApiError(
        "validation",
        "Please check the highlighted fields.",
        422,
        {
          contact_number: [
            "The contact number must be a valid mobile number, for example 09171234567.",
          ],
        },
      );
    }

    return {
      message: "Profile updated.",
      data: {
        ...current,
        contact_number: number,
        avatar_url: input.avatar
          ? input.avatar.uri
          : (current.avatar_url ?? null),
      },
    };
  }

  const formData = new FormData();
  formData.append("_method", "PATCH");
  formData.append("contact_number", input.contact_number.trim());
  if (input.avatar) {
    // React Native sends a file as an object with uri, name and type.
    formData.append("avatar", {
      uri: input.avatar.uri,
      name: input.avatar.name,
      type: input.avatar.mime_type,
    } as unknown as Blob);
  }

  return apiRequest<ApiItemResponse<AuthUser>>("/profile", {
    method: "POST",
    formData,
  });
}
