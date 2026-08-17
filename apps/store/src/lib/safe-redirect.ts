export function safeStoreRedirect(callbackUrl: string | null | undefined): string {
  if (!callbackUrl?.startsWith("/") || callbackUrl.startsWith("//")) return "/";

  try {
    const parsed = new URL(callbackUrl, "http://internal.local");
    if (parsed.origin !== "http://internal.local") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
