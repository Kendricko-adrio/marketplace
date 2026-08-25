import { randomInt } from "node:crypto";

// No ambiguous characters: O, I, 0, 1.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePickupCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[randomInt(CODE_CHARS.length)]
  ).join("");
}
