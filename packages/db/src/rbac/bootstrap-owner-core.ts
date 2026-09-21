// =========================================================
// RBAC: one-time System Owner bootstrap decision (pure)
// =========================================================
// The CLI wrapper (src/bootstrap-owner.ts) turns this plan into DB writes.
// The decision is pure so it is unit-testable: the one-time bootstrap refuses
// once an Owner exists, rejects invalid identity/password and missing input,
// and accepts a valid first Owner with no Home Branch and a forced password
// reset. The password is hashed by the caller — the plan never carries it.

export const MIN_PASSWORD_LENGTH = 8; // matches admin Better Auth minPasswordLength
export const MIN_USERNAME_LENGTH = 2; // matches admin username plugin

export interface BootstrapOwnerInput {
  name: string;
  email: string;
  username: string;
  password: string;
}

export interface BootstrapOwnerAssignment {
  roleKey: "system_owner";
  name: string;
  email: string;
  username: string;
  /** Owners are global — no Home Branch. */
  branchId: null;
  mustResetPassword: true;
}

export type BootstrapOwnerPlan =
  | { ok: true; assignment: BootstrapOwnerAssignment }
  | {
      ok: false;
      code: "OWNER_EXISTS" | "MISSING_INPUT" | "INVALID_IDENTITY" | "INVALID_PASSWORD";
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters, numbers, dot, hyphen, underscore — conservative username shape.
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]+$/u;

export function planBootstrapOwner(
  input: BootstrapOwnerInput,
  existingOwnerCount: number
): BootstrapOwnerPlan {
  // Refuse once an Owner exists — the CLI is a one-time bootstrap.
  if (existingOwnerCount > 0) {
    return { ok: false, code: "OWNER_EXISTS" };
  }

  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";

  if (!name || !email || !username || !password) {
    return { ok: false, code: "MISSING_INPUT" };
  }

  const identityValid =
    name.length >= 2 &&
    name.length <= 64 &&
    EMAIL_RE.test(email) &&
    username.length >= MIN_USERNAME_LENGTH &&
    username.length <= 64 &&
    USERNAME_RE.test(username);
  if (!identityValid) {
    return { ok: false, code: "INVALID_IDENTITY" };
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    return { ok: false, code: "INVALID_PASSWORD" };
  }

  return {
    ok: true,
    assignment: {
      roleKey: "system_owner",
      name,
      email,
      username,
      branchId: null,
      mustResetPassword: true,
    },
  };
}