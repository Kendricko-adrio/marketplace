export function safeAdminRedirect(callbackUrl: string | null | undefined): string {
  if (!callbackUrl?.startsWith("/admin")) return "/admin";
  if (callbackUrl.startsWith("//")) return "/admin";

  try {
    const parsed = new URL(callbackUrl, "http://internal.local");
    if (parsed.origin !== "http://internal.local") return "/admin";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/admin";
  }
}
