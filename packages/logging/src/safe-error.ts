/**
 * Safe projection of a thrown value into the `error` log field.
 *
 * Only technical, allowlisted keys are emitted: `name`, `message`, an optional
 * safe `code`, `stack`, and a bounded `cause` chain. Business data attached to
 * the error object (order ids, credentials, payloads) is never copied: the
 * projection is built field by field, not by spreading the original object, and
 * every field read is guarded so a throwing getter or proxy trap is treated as
 * an absent field instead of breaking the emission.
 *
 * Every emitted string is redacted before it is truncated, and `name`/`code`
 * are restricted to narrow technical tokens so neither can smuggle free text
 * (and therefore credentials) into the line.
 *
 * Deterministic limits (approved contract): message ≤ 2048 characters,
 * stack ≤ 8192 characters, at most 3 `cause` levels below the primary error.
 * A value that cannot be represented within those limits is replaced by a
 * marker string — `[truncated]` (limit reached) or `[circular]` (the cause chain
 * points back at an ancestor) — so the field shape stays stable.
 */

import { redactSensitiveText } from "./redaction.js";

const MESSAGE_MAX_LENGTH = 2048;
const STACK_MAX_LENGTH = 8192;
const CAUSE_MAX_DEPTH = 3;

const FALLBACK_NAME = "Error";
/** `name` must be a bounded technical token, never free text. */
const NAME_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** `code` must be an uppercase technical token (e.g. `ETIMEDOUT`). */
const CODE_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

const TRUNCATION_MARKER = "[truncated]";
const CIRCULAR_MARKER = "[circular]";

export type SafeErrorCause =
  | SafeErrorProjection
  | typeof TRUNCATION_MARKER
  | typeof CIRCULAR_MARKER;

export interface SafeErrorProjection {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SafeErrorCause;
}

/**
 * Projects any thrown value. Error-like objects are read field by field; a
 * primitive (thrown string, number, …) is carried as the projection message so
 * the line still says what went wrong.
 */
export function projectError(value: unknown): SafeErrorProjection {
  if (isRecord(value)) {
    return projectErrorLike(value, new Set<unknown>([value]), 0);
  }

  return {
    name: FALLBACK_NAME,
    message: truncate(
      redactSensitiveText(primitiveText(value)),
      MESSAGE_MAX_LENGTH
    ),
  };
}

function projectErrorLike(
  error: Record<string, unknown>,
  seen: Set<unknown>,
  causeDepth: number
): SafeErrorProjection {
  const projection: SafeErrorProjection = {
    name: safeName(readField(error, "name")),
    message: truncate(
      redactSensitiveText(asText(readField(error, "message")) ?? ""),
      MESSAGE_MAX_LENGTH
    ),
  };

  const stack = asText(readField(error, "stack"));
  if (stack !== undefined && stack.length > 0) {
    projection.stack = truncate(redactSensitiveText(stack), STACK_MAX_LENGTH);
  }

  // `code` is optional: a value that is not a narrow technical token carries no
  // safe signal, so it is dropped instead of being coerced.
  const code = safeCode(readField(error, "code"));
  if (code !== undefined) {
    projection.code = code;
  }

  const cause = readField(error, "cause");
  if (cause !== undefined) {
    projection.cause = projectCause(cause, seen, causeDepth);
  }

  return projection;
}

function projectCause(
  cause: unknown,
  seen: Set<unknown>,
  causeDepth: number
): SafeErrorCause {
  // Only error-like objects can be allowlisted; anything else is not copied
  // into the line, the marker keeps the shape stable.
  if (!isRecord(cause)) {
    return TRUNCATION_MARKER;
  }
  if (seen.has(cause)) {
    return CIRCULAR_MARKER;
  }
  if (causeDepth >= CAUSE_MAX_DEPTH) {
    return TRUNCATION_MARKER;
  }

  seen.add(cause);
  return projectErrorLike(cause, seen, causeDepth + 1);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeName(value: unknown): string {
  const text = asText(value);
  if (text === undefined) {
    return FALLBACK_NAME;
  }
  const redacted = redactSensitiveText(text);
  return NAME_TOKEN_PATTERN.test(redacted) ? redacted : FALLBACK_NAME;
}

function safeCode(value: unknown): string | undefined {
  const text = asText(value);
  if (text === undefined) {
    return undefined;
  }
  const redacted = redactSensitiveText(text);
  return CODE_TOKEN_PATTERN.test(redacted) ? redacted : undefined;
}

/**
 * Reads one allowlisted field from a possibly hostile value. Getters and proxy
 * traps that throw are treated as an absent field, so one broken property never
 * loses the rest of the projection or the surrounding log line.
 */
function readField(error: Record<string, unknown>, key: string): unknown {
  try {
    return error[key];
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function primitiveText(value: unknown): string {
  // `String()` handles symbols and null without throwing; the guard covers
  // exotic `Symbol.toPrimitive` implementations that do.
  try {
    return String(value);
  } catch {
    return "";
  }
}
