// Shared email branding config.
// BRAND_PRIMARY must match the `--primary` HSL token in
// apps/store/src/app/globals.css so email CTAs align with site buttons.
// Current primary: hsl(199 42% 9%) -> #061E29

export const BRAND_PRIMARY = "#061E29";
export const BRAND_PRIMARY_HOVER = "#0A2A38";
export const BRAND_NAME =
  process.env.NEXT_PUBLIC_APP_NAME || "Marketplace";
export const BRAND_SUPPORT_EMAIL =
  process.env.SMTP_FROM || "support@marketplace.local";
export const BRAND_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Verification token expiry (seconds). Mirrors Better Auth default.
export const EMAIL_VERIFICATION_EXPIRY_SECONDS = 60 * 60; // 1 hour