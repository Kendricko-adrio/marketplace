export type ClientAccessError = {
  status: 401 | 403;
  code: "UNAUTHORIZED" | "ONBOARDING_REQUIRED";
  error: string;
};

export function getClientAccessError(
  user: { onboardingCompleted?: boolean | null } | null | undefined
): ClientAccessError | null {
  if (!user) {
    return { status: 401, code: "UNAUTHORIZED", error: "Unauthorized" };
  }
  if (user.onboardingCompleted !== true) {
    return {
      status: 403,
      code: "ONBOARDING_REQUIRED",
      error: "Onboarding required",
    };
  }
  return null;
}
