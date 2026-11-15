import { describe, expect, it } from "vitest";
import { hqBranchSeedRow } from "./seed-hq";

describe("HQ branch seed", () => {
  it("provides an active local Home Branch without a Jubelio stock source", () => {
    expect(hqBranchSeedRow).toMatchObject({
      name: "HQ",
      code: "HQ",
      status: "aktif",
      jubelioLocationId: null,
      operatingHours: {},
    });
    expect(hqBranchSeedRow.id).toBeTruthy();
  });
});
