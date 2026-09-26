import dotenv from "dotenv";
dotenv.config({ path: "../../.env", quiet: true });
import { fetchMastersPage, fetchStocks } from "@marketplace/db/src/jubelio-sync";

async function main() {
  if (process.env.JUBELIO_SALES_TEST_ACCOUNT_ENABLED !== "true") throw new Error("sandbox not configured");
  for (let page = 1; page <= 5; page++) {
    const masters = await fetchMastersPage(page, 100);
    const ids = masters.data.flatMap((group) => (group.variants ?? []).map((variant) => variant.item_id)).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 100);
    if (!ids.length) continue;
    const response = await fetchStocks(ids);
    const stocked = response.data.flatMap((item) => (item.location_stocks ?? []).filter((row) => (row.available ?? 0) > 0 && (row.on_hand ?? 0) > 0).map((row) => ({ itemId: item.item_id, locationId: row.location_id, available: row.available, onHand: row.on_hand })));
    console.log(JSON.stringify({ page, stocked: stocked.sort((a, b) => (b.available ?? 0) - (a.available ?? 0)).slice(0, 10), count: stocked.length }));
    if (stocked.length) return;
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
