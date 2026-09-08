import { db, footerConfig, DEFAULT_FOOTER_CONFIG } from "@/db";
import {
  FloatingWhatsappButton,
  Footer,
  type FooterConfigData,
} from "@marketplace/ui";
import { getEnabledWhatsappUrl } from "@/lib/footer-whatsapp";

// Force dynamic so the footer is always fetched fresh on every request.
// Without this, Next.js might statically render the footer once at build time
// and never pick up admin edits.
export const dynamic = "force-dynamic";

// Async Server Component that fetches the footer config from the DB and
// renders the shared <Footer /> from @marketplace/ui. When the DB row is
// missing or the query fails, <Footer /> falls back to its own
// DEFAULT_FOOTER_CONFIG internally.
export default async function FooterWrapper() {
  let config: FooterConfigData | null = null;
  try {
    const rows = await db
      .select({ data: footerConfig.data })
      .from(footerConfig)
      .limit(1);
    if (rows.length > 0) {
      config = rows[0].data as FooterConfigData;
    }
  } catch (error) {
    console.error("Error fetching footer config:", error);
  }

  const effectiveConfig = config ?? DEFAULT_FOOTER_CONFIG;
  const whatsappUrl = getEnabledWhatsappUrl(effectiveConfig.socialMedia);

  return (
    <>
      <Footer config={effectiveConfig} />
      {whatsappUrl && <FloatingWhatsappButton href={whatsappUrl} />}
    </>
  );
}