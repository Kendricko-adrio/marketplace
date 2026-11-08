import { keyId } from "./ids";
import type { branches } from "./schema/branches";

// Branch administratif lokal, bukan lokasi penjualan atau sumber stok Jubelio.
export const hqBranchSeedRow = {
  id: keyId("local:branch:", "hq"),
  name: "HQ",
  code: "HQ",
  jubelioLocationId: null,
  city: "Belum dikonfigurasi",
  address: "Kantor pusat (HQ)",
  operatingHours: {},
  status: "aktif",
} satisfies typeof branches.$inferInsert;
