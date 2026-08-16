import { describe, it, expect } from "vitest";
import { isEmail } from "./login-utils";

describe("isEmail", () => {
  it("returns true for a plain email address", () => {
    expect(isEmail("admin@store.com")).toBe(true);
  });

  it("returns true for an email with a subdomain + multi-part TLD", () => {
    expect(isEmail("user@mail.example.co.id")).toBe(true);
  });

  it("returns false for a username (no @)", () => {
    expect(isEmail("admintoko")).toBe(false);
  });

  it("returns false for a username containing a dot", () => {
    expect(isEmail("john.doe")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEmail("")).toBe(false);
  });

  it("returns false when @ is missing the domain part", () => {
    expect(isEmail("admin@")).toBe(false);
  });

  it("returns false when whitespace is present", () => {
    expect(isEmail("admin @store.com")).toBe(false);
  });
});
