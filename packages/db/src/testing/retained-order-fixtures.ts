import type { Pool } from "pg";

/** Test-only teardown: callers must supply their own exact fixture order IDs. */
export async function deleteRetainedOrderFixtures(pool: Pool, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await pool.query("DELETE FROM delivery_booking_reviews WHERE order_id=ANY($1::text[])", [orderIds]);
  await pool.query("DELETE FROM delivery_tracking_event e USING delivery_shipment s WHERE e.shipment_id=s.id AND s.order_id=ANY($1::text[])", [orderIds]);
  await pool.query("DELETE FROM delivery_shipment WHERE order_id=ANY($1::text[])", [orderIds]);
  await pool.query("DELETE FROM jubelio_channel_status_intent WHERE order_id=ANY($1::text[])", [orderIds]);
  await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id=ANY($1::text[])", [orderIds]);
  // Redemption lifecycle (ticket 07): append-only events → allocations →
  // Redemption. The Redemption's order/client/Offer FKs are RESTRICT, so it
  // must go before `orders`. Guarded so a pre-07 disposable database can still
  // run the legacy fixtures.
  const tables = await pool.query(
    `SELECT to_regclass('public.discount_redemption') IS NOT NULL AS redemption,
            to_regclass('public.discount_redemption_event') IS NOT NULL AS event,
            to_regclass('public.order_discount_allocation') IS NOT NULL AS allocation`
  );
  const present = tables.rows[0] as { redemption: boolean; event: boolean; allocation: boolean };
  if (present.event && present.redemption) {
    await pool.query(
      "DELETE FROM discount_redemption_event WHERE redemption_id IN (SELECT id FROM discount_redemption WHERE order_id=ANY($1::text[]))",
      [orderIds]
    );
  }
  if (present.allocation) {
    await pool.query("DELETE FROM order_discount_allocation WHERE order_id=ANY($1::text[])", [orderIds]);
  }
  if (present.redemption) {
    await pool.query("DELETE FROM discount_redemption WHERE order_id=ANY($1::text[])", [orderIds]);
  }
  // Kompatibel dengan disposable DB baseline sebelum migration ticket 02.
  const checkout = await pool.query("SELECT to_regclass('checkout_request') AS name");
  if (checkout.rows[0]?.name) {
    await pool.query("DELETE FROM checkout_request WHERE order_id=ANY($1::text[])", [orderIds]);
  }
  await pool.query("DELETE FROM order_item WHERE order_id=ANY($1::text[])", [orderIds]);
  await pool.query("DELETE FROM orders WHERE id=ANY($1::text[])", [orderIds]);
}
