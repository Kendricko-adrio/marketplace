import {
  BRAND_PRIMARY,
  BRAND_NAME,
  BRAND_SUPPORT_EMAIL,
} from "@/lib/email-config";

interface ResetPasswordEmailProps {
  url: string;
  name: string;
  appName?: string;
}

/**
 * Inline-CSS HTML template for the password reset email.
 * - Single column 600px table on a light gutter.
 * - Solid brand-color CTA button.
 * - Muted fallback link (break-all) for clients that strip buttons.
 * - Footer: expiry + ignore note + brand info.
 * All CSS is inline because Gmail strips <style> blocks.
 */
export function resetPasswordEmailHTML({
  url,
  name,
  appName = BRAND_NAME,
}: ResetPasswordEmailProps): string {
  const year = new Date().getFullYear();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <!-- Header / wordmark -->
            <tr>
              <td style="padding:32px 40px 8px 40px;text-align:left;">
                <span style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${BRAND_PRIMARY};">${escapeHtml(appName)}</span>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:16px 40px 24px 40px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:28px;font-weight:700;color:#18181b;">Reset your password</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#3f3f46;">${greeting}</p>
                <p style="margin:0 0 28px 0;font-size:15px;line-height:24px;color:#3f3f46;">We received a request to reset the password for your <strong style="color:#18181b;">${escapeHtml(appName)}</strong> account. Click the button below to choose a new password.</p>
                <!-- CTA -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td align="center">
                      <a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:100%;max-width:320px;padding:14px 32px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;color:#ffffff;background-color:${BRAND_PRIMARY};border-radius:8px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#71717a;">Or paste this link into your browser:</p>
                <p style="margin:0 0 28px 0;font-size:13px;line-height:20px;color:#71717a;word-break:break-all;"><a href="${escapeAttr(url)}" style="color:#71717a;text-decoration:underline;">${escapeHtml(url)}</a></p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#71717a;">This link expires in 1 hour.</p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid #e4e4e7;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#71717a;">If you didn't request a password reset, you can safely ignore this email &mdash; your password will not be changed.</p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#a1a1aa;">${escapeHtml(appName)} &middot; ${year}<br />${escapeHtml(BRAND_SUPPORT_EMAIL)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Plain-text fallback (for clients that block HTML or for accessibility).
 */
export function resetPasswordEmailText({
  url,
  name,
  appName = BRAND_NAME,
}: ResetPasswordEmailProps): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return `${greeting}

We received a request to reset the password for your ${appName} account. Open the link below to choose a new password:

${url}

This link expires in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

${appName} · ${BRAND_SUPPORT_EMAIL}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}