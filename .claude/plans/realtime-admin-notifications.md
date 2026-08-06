# Plan: Real-Time Admin Notifications for Paid Orders

## Goal
Build a real-time notification system so branch admins (and HQ) know immediately when a customer finishes paying for an order. Two UI surfaces:
1. A notification bell in the top-right of every admin page with an unread badge and sound alert.
2. A dedicated `/admin/notifications` page where admins can idle and view/clear incoming order notifications.

## Context
- Stack: Next.js 16 App Router (store :3000, admin :3001), Drizzle ORM, PostgreSQL, Better Auth (separate admin/store instances), shadcn/ui, Tailwind.
- Order lifecycle: `place-order` creates `orders.status = pending_payment` → Midtrans webhook calls `claimAndFinalizePaidOrder()` → on success flips to `paymentStatus = paid` and `status = ready_for_pickup`.
- Admin RBAC: `role = hq` sees all branches; `role = admin` with `branchId` sees only that branch.
- Admin layout already has a header placeholder comment for notifications.

## 1. Transport: Long Polling (user choice)

### Decision
User chose **long polling utama**. We will implement classic long polling as the real-time transport for admin notifications.

### Long-polling design in Next.js 16 App Router
- Endpoint: `GET /api/admin/notifications/poll?since={isoTimestamp}`.
- Server holds the request open for up to ~25–30 seconds (below common proxy timeouts).
- If no new notification arrives before the timeout, respond with `{ success, data: [], hasMore: false }`; client reconnects immediately.
- If a new notification for the user's branch scope is inserted, wake the waiting request and respond with `{ success, data: [notification], unreadCount }`.
- Client reconnects immediately after every response, keeping near-real-time latency.
- Set `export const dynamic = 'force-dynamic'` so the route is never statically generated / ISR-buffered.

### Why long polling over SSE here
- User explicitly prefers it.
- Simpler mental model for many teams and easier to debug with curl/Network tab.
- Works through older proxies/firewalls that may buffer or block `text/event-stream`.
- Trade-off: slightly higher reconnect overhead than SSE and no native auto-reconnect, but acceptable for a low-frequency event stream (order paid events).

### Wakeup / broadcast mechanism
- **Single-instance / dev**: keep an in-process `EventEmitter` + Map of pending poll requests per branch scope. When `claimAndFinalizePaidOrder` inserts a notification, emit to matching listeners, which resolve their pending responses.
- **Multi-instance / production**: in-process emit only reaches clients connected to the same server process. When scaling beyond one instance, add **Postgres `LISTEN/NOTIFY`** (or Redis Pub/Sub) so every server process wakes its local pending polls. We will design the notifier interface so this upgrade is a drop-in replacement.

## 2. Data Model

Add a `notifications` table in `packages/db/src/schema/notifications.ts` and export it from `index.ts`.

```text
notifications
  id: text primaryKey (uuid)
  type: text notNull default 'order_paid'   -- 'order_paid' | 'order_failed' | etc.
  orderId: text -> orders.id (onDelete cascade)
  branchId: text -> branches.id (onDelete cascade)
  recipientRoleScope: text default 'branch' -- 'branch' | 'hq' | 'all'
  title: text notNull
  message: text
  isRead: boolean notNull default false
  readAt: timestamp with timezone
  createdAt: timestamp with timezone notNull defaultNow
  updatedAt: timestamp with timezone notNull defaultNow
```

Add indexes:
- `(branchId, isRead, createdAt)` for unread list queries.
- `(recipientRoleScope, isRead, createdAt)` for HQ/global queries.
- `(orderId)` for duplicate suppression / debugging.

Relations: `notifications.order` → `orders`, `notifications.branch` → `branches`.

Update `packages/db/src/seed.ts` with sample notification rows and a `DELETE` at the top respecting FK order.

## 3. Trigger Points

Insert a notification **only after the order is successfully claimed as paid** (i.e., inside or immediately after `claimAndFinalizePaidOrder` when `claimed === true`).

Why here and not in the Midtrans webhook directly:
- The finalizer has a claim guard; we only want one notification per paid order.
- The order is already in `ready_for_pickup` state with a `pickupCode`, so the notification can include useful details (branch, total, pickup time).

Implementation hook: in `apps/store/src/lib/order-finalize.ts`, after the transaction succeeds and returns `claimed = true`, insert a `notification` row for `order.branchId` with `type = 'order_paid'`.

## 4. Backend API Surface (admin app)

All under `apps/admin/src/app/api/admin/notifications/`.

1. **GET /api/admin/notifications/poll** — long-polling endpoint.
   - Query param `?since={ISO8601}` (last notification timestamp known to client).
   - Auth via `withAuth(['admin','hq'])`.
   - On connect: immediately return any notifications with `createdAt > since` for the user's scope.
   - If none, hold the request until one arrives or ~25–30s timeout.
   - Response: `{ success, data: Notification[], unreadCount }`.
   - Scope: branch admins only receive notifications for `branchId = user.branchId`; HQ receives all notifications.
   - `dynamic = 'force-dynamic'`.

2. **GET /api/admin/notifications** — paginated list.
   - Query params: `?isRead=all|unread|read&page&limit`.
   - Return `{ success, data, pagination }`.
   - Scope by branch/HQ.

3. **PATCH /api/admin/notifications/:id/read** — mark one as read.

4. **POST /api/admin/notifications/mark-all-read** — mark all in-scope notifications as read (used from bell or page).

5. **DELETE /api/admin/notifications/:id** — remove a notification (the "clean" action).

6. **DELETE /api/admin/notifications/clear-all-read** — bulk delete already-read notifications.

## 5. Frontend Components (admin app)

### NotificationBell (client component)
- Mounts in `apps/admin/src/app/admin/layout.tsx` header.
- Uses a `useEffect` loop to long-poll `/api/admin/notifications/poll?since=...`.
- Keeps `since` as the `createdAt` of the most recent notification received.
- Maintains `unreadCount` state; shows a badge on the bell icon.
- **Clicking the bell opens a dropdown and marks all in-scope notifications as read** (user choice: bell click = mark all read).
- Plays a short notification sound when `unreadCount` increases from a poll response and the document is visible.
- Dropdown shows the latest N notifications and a "View all" link.
- Handles abort controller cleanup on unmount / effect re-run.

### NotificationProvider (client wrapper)
- Share the single poller + unread count across the admin app so the bell and `/admin/notifications` page do not open duplicate long-poll connections.
- Wrap the admin layout with this provider.

### /admin/notifications page
- Full-page list of notifications, default filter `isRead = all`.
- **Opening the page marks all in-scope notifications as read** (user choice: page open = mark all read).
- Real-time incoming rows via the shared long-poll context.
- Actions per row: "Mark as read", "Delete".
- Bulk actions: "Mark all read", "Clear read notifications".
- Empty state for no notifications.
- Branch column visible to HQ; hidden for branch admins.
- Link each notification to `/admin/orders/{orderId}`.

### Sound behavior
- Use the Web Audio API or a short `<audio>` element.
- Sound only plays after a user gesture has unlocked audio (e.g., first click anywhere on the admin app). Persist a "sound enabled" flag in `localStorage` and allow muting from the bell dropdown.
- Browsers block autoplay without interaction; we will not fight this, but surface a mute/unmute toggle.

## 6. UI / UX Details

- Bell icon: `Bell` from `lucide-react`.
- Badge: small rounded dot/number at top-right; cap display at `9+` or show exact count.
- On new notification while on another tab: optionally update `document.title` with `(N) Admin Dashboard` and/or use the Page Visibility API to avoid sounds when tab is hidden.
- Toast/snackbar is optional; the sound + badge is the primary alert.

## 7. Auth, Permissions, and RBAC

- Add a new module `notifications` to the permission system (`packages/db/src/schema/permissions.ts` / seeder) with `canView = true` for both roles.
- Protect `/admin/notifications` page and API endpoints with `withPermission('notifications', 'view')` (or `withAuth` for stream).
- Branch scoping is enforced server-side in every endpoint and in the broadcaster.

## 8. Testing / Verification Plan

1. Place an order as a customer and complete payment via Midtrans sandbox (or manually set `paymentStatus = paid`).
2. Verify a notification row is inserted with correct `branchId`.
3. Open admin app with a branch admin account: within the poll interval, badge increments, sound plays, notification appears in dropdown.
4. Open `/admin/notifications`: page auto-mark-reads; new notifications still visible in history until deleted.
5. Test HQ account receives notifications for all branches.
6. Test multiple tabs: each tab has its own pending poll; badge syncs because server is the source of truth.
7. Simulate network offline/online: client reconnects and catches up using `since` parameter.

## 9. Documentation Updates

- Add `notifications` schema notes to `docs/` (new `docs/notifications.md`).
- Add all 5 notification endpoints to `docs/api-reference.md`.
- Add a section in `docs/deployment/README.md` about multi-instance broadcasting if Redis is chosen.

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Long-polling pending requests hold server resources | Cap timeout at ~25–30s; abort on client disconnect; keep request handler lightweight. |
| Many admin tabs = many pending requests | Shared `NotificationProvider` reduces duplicate polls per tab, but each browser tab still opens one pending request. Acceptable for small-to-medium admin counts. |
| Browser autoplay blocks sound | Only play after first user interaction; provide mute toggle. |
| Multi-instance broadcast gaps | Start with in-memory `EventEmitter`; add Postgres `LISTEN/NOTIFY` (or Redis) when scaling beyond one instance. |
| Notification spam if webhook retries | Insert notification only after the claim guard returns `claimed = true`. |
| Proxy/firewall timeouts on long polls | Keep timeout below common proxy defaults; client immediately reconnects on timeout. |

## 11. All User Decisions Captured

| Topic | Decision |
|---|---|
| Trigger events | Only **paid orders** (`paymentStatus → paid`, `status → ready_for_pickup`) |
| Recipients | Branch admin → own branch; HQ → all branches |
| Mark-as-read | **Both** clicking the bell and opening `/admin/notifications` mark all in-scope notifications as read |
| Real-time transport | **Long polling utama** |
| Cleaning | Delete per notification + "Clear all read notifications" button |
| Sound | Play on every new event, with mute/unmute toggle |
| Badge | Exact count |
| Deployment | Single instance now, may scale later |

## 12. Remaining Micro-Decisions (defaults I'll use unless you override)

1. **Mute persistence**: saved in `localStorage` per browser (not per-user DB).
2. **Delete type**: hard delete from DB (no soft delete/archive).
3. **Auto-expire cron**: none for now; read notifications stay until manually deleted.
4. **Bell dropdown limit**: show the latest 10 unread/recent notifications.
5. **Poll timeout**: 25 seconds; reconnect immediately after response or timeout.
6. **Notification sound**: short UI chime (e.g., a generated oscillator tone or a small public-domain WAV). No external CDN dependency.
7. **Page title update**: yes, `document.title` becomes `(N) Admin Dashboard` when unread > 0.
8. **RBAC module**: add `notifications` module with `canView = true` for `admin` and `hq` roles by default.

## 13. Open Questions for Product Owner

Only minor ones remain:

1. Apakah halaman `/admin/notifications` perlu badge/sidebar indicator unread count juga (seperti "Pesanan" saat ada order baru)?
2. Apakah suara boleh menggunakan Web Audio API generated tone, atau kamu punya asset audio tertentu yang harus dipakai?
3. Apakah notifikasi perlu dikirim juga ke admin yang sedang offline lalu muncul saat mereka login berikutnya? (Ini sudah otomatis terjadi karena kita menyimpan notifikasi di DB; badge akan menampilkan unread count dari DB saat login.)
