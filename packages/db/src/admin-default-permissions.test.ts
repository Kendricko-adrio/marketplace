import { describe, expect, it } from "vitest";
import { adminDefaultCustomerPermission } from "./schema/permissions";

describe("admin default customer permission", () => {
  it("keeps the Customer module hidden from branch admins", () => {
    expect(adminDefaultCustomerPermission).toEqual({
      role: "admin",
      module: "customers",
      canView: false,
      canEdit: false,
      canDelete: false,
    });
  });
});
