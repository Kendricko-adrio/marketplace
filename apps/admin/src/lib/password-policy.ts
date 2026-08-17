const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const COMPLEXITY_ERROR =
  "Password harus mengandung huruf besar, huruf kecil, dan angka.";

export function getPasswordPolicyError(
  path: string,
  method: string,
  body: unknown
): string | null {
  if (method !== "POST") return null;

  const fields = (body ?? {}) as { password?: string; newPassword?: string };
  const password =
    path === "/sign-up/email"
      ? fields.password
      : path === "/reset-password" || path === "/change-password"
        ? fields.newPassword
        : undefined;

  if (!password || PASSWORD_COMPLEXITY_REGEX.test(password)) return null;
  return COMPLEXITY_ERROR;
}
