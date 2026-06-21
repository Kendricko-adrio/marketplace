// Shared email branding config for the admin app.
// BRAND_PRIMARY matches the sidebar slate-900 token used in the admin UI.

export const BRAND_PRIMARY = "#0f172a"; // slate-900
export const BRAND_PRIMARY_HOVER = "#1e293b"; // slate-800
export const BRAND_NAME =
  process.env.NEXT_PUBLIC_APP_NAME || "Marketplace Admin";
export const BRAND_SUPPORT_EMAIL =
  process.env.SMTP_FROM || "support@marketplace.local";
// Admin app runs on port 3001 in dev. In production set NEXT_PUBLIC_ADMIN_URL.
export const BRAND_APP_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3001";

// Better Auth password reset token expiry (seconds). Mirrors the default.
export const RESET_PASSWORD_TOKEN_EXPIRY_SECONDS = 60 * 60; // 1 hour