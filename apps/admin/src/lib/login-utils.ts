/**
 * login-utils — pure helpers shared by admin auth flows.
 *
 * Extracted from the admin login form so the email-vs-username branch can be
 * unit-tested without a browser.
 */

/** True when `value` looks like an email; otherwise it's treated as a username. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
