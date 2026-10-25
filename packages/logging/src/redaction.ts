/**
 * Best-effort redaction of recognised sensitive values in log text.
 *
 * Scope of the guarantee: this is a deny-list over shapes we can recognise —
 * known assignment keys (plain, quoted, or JSON-like `"key":"value"`), an
 * authorization/cookie header, a bare `Bearer`/`Basic` credential of any
 * length, e-mail addresses, URL userinfo credentials, and URL query values. A
 * recognised assignment hides its **whole** value: a quoted or JSON-like value
 * up to its closing quote (escapes included), an unquoted value up to the next
 * whitespace or up to the `&key=` boundary that starts the next query pair. It
 * is **not** a universal scrubber: a secret or PII embedded in free text (or an
 * e-mail shape the bounded candidate window does not cover) may still slip
 * through. Callers therefore remain responsible for sending safe summaries
 * instead of raw request bodies, provider payloads or rows.
 *
 * Key names are kept so a line stays searchable (`password=[redacted]`,
 * `"token":"[redacted]"`, `?token=[redacted]&branch=[redacted]`), the recognised
 * value is replaced by `[redacted]` / `[redacted-email]`. When a shape is
 * ambiguous this module prefers over-redaction: losing a little context is
 * cheaper than leaking a credential (a header value and a bare scheme token are
 * therefore cut to the end of the credential, even for plain prose). Redaction
 * never parses a URL and never inspects the payload structure, so malformed
 * input cannot throw. Only the e-mail pattern uses a bounded candidate window
 * (local-part/domain/TLD caps); the other patterns have no complexity analysis
 * behind them, so this module claims no universal complexity guarantee.
 */

const REDACTED = "[redacted]";
const REDACTED_EMAIL = "[redacted-email]";

/**
 * Header-style values are secret for the rest of the line. The quote capture
 * keeps JSON-like payloads (`{"authorization":"..."}`) reachable.
 */
const HEADER_VALUE_PATTERN =
  /\b((?:proxy-)?authorization|(?:set-)?cookie)\b(["']?)(\s*[=:]\s*)[^\n]*/gi;

/** A bare scheme token, e.g. from a value already stripped of its header. */
const AUTH_SCHEME_PATTERN = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * `key=value`, `key: value`, or `"key":"value"` — plain or quoted values.
 *
 * A quoted value is matched in full, escapes included: a JSON-like
 * `{"password":"a\"b"}` must disappear up to its closing quote instead of
 * dying at the escaped one. An unquoted value runs to the next whitespace,
 * because a recognised key is meant to hide its whole value — stopping at
 * punctuation used to leave the tail of `password=Pass,word;2024` on the line
 * without a label. `&` is the one deliberate exception: it separates pairs in a
 * URL query, so `?token=x&branch=JKT-01` keeps the following key instead of
 * swallowing it.
 */
const ASSIGNMENT_PATTERN =
  /\b(password|passwd|pwd|secret|access[_-]?token|refresh[_-]?token|token|api[_-]?key|apikey|client[_-]?secret)\b(["']?)(\s*[=:]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&]+)/gi;

/** `scheme://user:password@host` — the userinfo part is dropped. */
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;

/** `?key=value&key=value` — values are dropped, key names are kept. */
const URL_QUERY_PATTERN = /([?&])([^=&\s#'"<>]+)=([^&\s#'"<>]*)/g;

/** Bounded candidate window: local part, domains, and TLD are all capped. */
const EMAIL_PATTERN = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}/gi;

export function redactSensitiveText(text: string): string {
  return text
    .replace(
      HEADER_VALUE_PATTERN,
      (_match: string, key: string, keyQuote: string, separator: string) =>
        `${key}${keyQuote}${separator}${REDACTED}`
    )
    .replace(
      AUTH_SCHEME_PATTERN,
      (_match: string, scheme: string) => `${scheme} ${REDACTED}`
    )
    .replace(
      ASSIGNMENT_PATTERN,
      (
        _match: string,
        key: string,
        keyQuote: string,
        separator: string,
        value: string
      ) => `${key}${keyQuote}${separator}${quotedRedacted(value)}`
    )
    .replace(
      URL_USERINFO_PATTERN,
      (_match: string, scheme: string) => `${scheme}${REDACTED}@`
    )
    .replace(
      URL_QUERY_PATTERN,
      (_match: string, delimiter: string, key: string) =>
        `${delimiter}${key}=${REDACTED}`
    )
    .replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

/** Keeps the value's own quoting so JSON-like text stays readable. */
function quotedRedacted(value: string): string {
  const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
  return `${quote}${REDACTED}${quote}`;
}
