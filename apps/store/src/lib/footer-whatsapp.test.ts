import { describe, expect, it } from "vitest";
import { getEnabledWhatsappUrl } from "./footer-whatsapp";

describe("getEnabledWhatsappUrl", () => {
  it("returns an enabled HTTP(S) WhatsApp URL", () => {
    expect(
      getEnabledWhatsappUrl([
        { platform: "instagram", url: "https://instagram.com/adf", enabled: true },
        { platform: "whatsapp", url: "https://wa.me/6281234567890", enabled: true },
      ])
    ).toBe("https://wa.me/6281234567890");
  });

  it.each([
    { links: [{ platform: "whatsapp" as const, url: "https://wa.me/1", enabled: false }] },
    { links: [{ platform: "whatsapp" as const, url: "", enabled: true }] },
    { links: [{ platform: "whatsapp" as const, url: "not-a-url", enabled: true }] },
    { links: [{ platform: "whatsapp" as const, url: "javascript:alert(1)", enabled: true }] },
  ])("returns null for disabled or unsafe values", ({ links }) => {
    expect(getEnabledWhatsappUrl(links)).toBeNull();
  });
});
