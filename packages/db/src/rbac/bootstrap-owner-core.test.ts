import { describe, it, expect } from "vitest";
import {
  planBootstrapOwner,
  type BootstrapOwnerPlan,
} from "./bootstrap-owner-core";

// The exported bootstrap decision (pure) — the CLI wrapper only turns the
// plan into DB writes. Expected outcomes hand-derived from the design:
// the one-time CLI refuses once an Owner exists, rejects invalid
// identity/password and missing input, and accepts a valid first Owner with
// no Home Branch and a forced password reset.

const validInput = {
  name: "System Owner",
  email: "owner@example.invalid",
  username: "owner",
  password: "correct horse battery staple",
};

describe("bootstrap owner decision", () => {
  it("accepts a valid first Owner: no Home Branch and forced password reset", () => {
    const plan: BootstrapOwnerPlan = planBootstrapOwner(validInput, 0);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.assignment.roleKey).toBe("system_owner");
      expect(plan.assignment.branchId).toBeNull();
      expect(plan.assignment.mustResetPassword).toBe(true);
      expect(plan.assignment.email).toBe("owner@example.invalid");
      // The password is hashed by the caller; the plan never carries it.
      expect(JSON.stringify(plan)).not.toContain(validInput.password);
    }
  });

  it("rejects when an Owner already exists", () => {
    const plan = planBootstrapOwner(validInput, 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("OWNER_EXISTS");
  });

  it("rejects missing input", () => {
    for (const field of ["name", "email", "username", "password"] as const) {
      const input = { ...validInput, [field]: "" };
      const plan = planBootstrapOwner(input, 0);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.code).toBe("MISSING_INPUT");
    }
  });

  it("rejects invalid identity fields", () => {
    const badEmail = planBootstrapOwner(
      { ...validInput, email: "not-an-email" },
      0
    );
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.code).toBe("INVALID_IDENTITY");

    const shortUsername = planBootstrapOwner(
      { ...validInput, username: "a" },
      0
    );
    expect(shortUsername.ok).toBe(false);
    if (!shortUsername.ok) expect(shortUsername.code).toBe("INVALID_IDENTITY");
  });

  it("rejects passwords shorter than the admin auth minimum", () => {
    const plan = planBootstrapOwner({ ...validInput, password: "short7" }, 0);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("INVALID_PASSWORD");
  });
});