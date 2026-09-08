import type { SocialMediaLink } from "@marketplace/db/src/schema/footer";

export function getEnabledWhatsappUrl(
  links: readonly SocialMediaLink[] | null | undefined
): string | null {
  const candidate = links?.find(
    (link) => link.platform === "whatsapp" && link.enabled
  )?.url.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}
