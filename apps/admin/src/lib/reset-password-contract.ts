import { z } from "zod";

export const resetPasswordSchema = z.discriminatedUnion("passwordMode", [
  z.object({ passwordMode: z.literal("generate") }),
  z.object({
    passwordMode: z.literal("manual"),
    password: z.string().min(8, "Password minimal 8 karakter"),
  }),
]);

export type ResetPasswordPayload = z.infer<typeof resetPasswordSchema>;

export function buildResetPasswordPayload(
  passwordMode: "generate" | "manual",
  password?: string
): ResetPasswordPayload {
  return passwordMode === "manual"
    ? { passwordMode, password: password ?? "" }
    : { passwordMode };
}
