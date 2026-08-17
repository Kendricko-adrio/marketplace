import { describe, expect, it } from "vitest";
import {
  filterCustomers,
  formatCustomerDate,
  getCustomerInitials,
} from "./customer-display";

const customers = [
  {
    name: "John Doe",
    email: "john@example.com",
    phone: "081234567890",
  },
  {
    name: "Jane Smith",
    email: "jane@example.com",
    phone: null,
  },
];

describe("customer display", () => {
  it("filters customers by name, email, or phone", () => {
    expect(filterCustomers(customers, "0812")).toEqual([customers[0]]);
    expect(filterCustomers(customers, "JANE@")).toEqual([customers[1]]);
  });

  it("formats profile values consistently for the admin UI", () => {
    expect(getCustomerInitials("John Ronald Doe")).toBe("JD");
    expect(formatCustomerDate("1994-06-15", "date")).toBe("15 Jun 1994");
    expect(formatCustomerDate(null, "date")).toBe("—");
  });
});
