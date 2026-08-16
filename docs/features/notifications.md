# Admin Real-Time Notifications

## Purpose
Notify branch admin staff immediately when a customer successfully pays for an order, so they can prepare the pickup. Notifications are also visible to HQ staff for all branches.

## What triggers a notification
Only the **paid order** lifecycle event creates a notification today:

- Midtrans webhook calls `claimAndFinalizePaidOrder()` in `apps/store/src/lib/order-finalize.ts`.
- When the claim guard flips the order to `paymentStatus = paid` and `status = ready_for_pickup`, a row is inserted into `notifications` for the order's `branchId`.

This guarantees exactly one notification per paid order even if the Midtrans webhook is retried.

## Data model

Table: `notifications` (owned by `packages/db/src/schema/notifications.ts`).
Created by migration `0009_tan_sheva_callister.sql` (DB table name:
`notification`, exported as `notifications`).

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `type` | `"order_paid"` (extensible for future event types) |
| `orderId` | FK to `orders.id`, cascade delete |
| `branchId` | FK to `branches.id`, cascade delete |
| `title` | Short title shown in the bell dropdown and page |
| `message` | Optional longer message |
| `isRead` | Boolean; `false` when inserted |
| `readAt` | Set when marked as read |
| `createdAt` / `updatedAt` | `timestamptz` per project convention |

Indexes:
- `idx_notifications_branch_unread_created` on `(branchId, isRead, createdAt)` for fast unread count + catch-up queries.
- `idx_notifications_order_id` for debugging / duplicate suppression.

## Transport: long polling

The user chose **long polling** as the primary real-time transport. Why not WebSocket / SSE:

- No need for bidirectional communication.
- Simpler to debug and more compatible with older proxies/firewalls than SSE.
- Order-paid events are low-frequency; a reconnect every ~25 seconds is acceptable.

### How it works

1. The admin UI opens `GET /api/admin/notifications/poll`.
2. First request has no `since` param; the server returns the current unread count and a `serverNow` watermark.
3. The client immediately reconnects with `?since={serverNow}`.
4. If new notifications exist, they are returned immediately.
5. Otherwise the server holds the request for up to ~25s. If a matching notification is inserted, the pending request wakes and returns it.
6. The client reconnects immediately after every response.

### Broadcasting

`apps/admin/src/lib/notification-broadcaster.ts` keeps an in-memory map of pending long-poll resolvers keyed by branch scope (`branch:{branchId}` and `hq`).

To make real-time work even when the storefront and admin apps run in separate processes (which is the case during local `npm run dev:all` as well as in many production deployments), we use **Postgres `LISTEN/NOTIFY`**:

1. When `claimAndFinalizePaidOrder` inserts a notification row, it also executes `pg_notify('new_notification', JSON.stringify({ id: notificationId }))`.
2. The admin app opens a dedicated `PoolClient` and runs `LISTEN new_notification` on startup.
3. On every `notification` event it fetches the row by id and calls `emitNotification()`, waking any pending long-poll request whose scope matches the row's `branchId` (and all HQ listeners).

This works across multiple Next.js app instances as long as they share the same PostgreSQL database. If you ever move away from Postgres or need fan-out across datacenters, the broadcaster interface is small enough to swap the `LISTEN/NOTIFY` client for Redis Pub/Sub without touching the rest of the code.

## RBAC / scope

- Branch admin (`role = "admin"`, `branchId` set) → sees only notifications for that branch.
- HQ (`role = "hq"` or `branchId` null) → sees all branches.

The `notifications` module was added to the RBAC permission matrix (`packages/db/src/schema/permissions.ts` and `apps/admin/src/lib/permissions-shared.ts`). Default seeded permissions for the `admin` role:

- `canView: true`
- `canEdit: true` (mark as read)
- `canDelete: true` (delete / clear read)

HQ is an implicit superuser.

## UI surfaces

### 1. Notification bell (`NotificationBell`)

- Located in the top-right header on every admin page.
- Shows an exact unread count badge.
- Opens a popover listing the latest 10 notifications.
- Plays a short UI chime on every new event (unless muted).
- **Opening the bell marks all in-scope notifications as read** (product decision).
- Per-row delete is available inside the dropdown.
- Mute state is persisted in `localStorage`.

### 2. `/admin/notifications` page

- Full-page list with filter tabs: All / Unread / Read.
- Shows branch column for HQ, hidden for branch admins.
- **Opening the page marks all in-scope notifications as read**.
- Actions per row:
  - Mark as read
  - Verify pickup (link to order detail with `?verify=1`)
  - Delete
- Bulk actions:
  - Mark all as read
  - Clear read notifications
- Uses the same long-poll provider as the bell, so new notifications appear without a full refresh.

### 3. Sidebar

A "Notifikasi" link was added to `AdminSidebar` under `/admin/notifications`.

## Sound

- Plays the bundled `/sounds/notification.mp3` asset (located at `apps/admin/public/sounds/notification.mp3`).
- A single reusable `HTMLAudioElement` is created lazily on first play so repeat notifications replay in full without piling up elements or re-fetching the file.
- Volume is set to a soft `0.35` so the chime is gentle rather than startling.
- To change the sound, replace `apps/admin/public/sounds/notification.mp3` with your own file (keep the same name, or update the path in `apps/admin/src/providers/notification-provider.tsx`).
- Browsers require a user gesture before audio can play; the first click on any admin UI unlocks playback.
- Mute/unmute toggle is in the bell popover.

## Operational notes

- **No auto-expire by default**: notifications stay in the DB until manually deleted.
- **Hard deletes**: deleting a notification removes the row permanently.
- **Document title**: changes to `(N) Admin Dashboard` when unread count > 0.

## Files changed / added

- `packages/db/src/schema/notifications.ts` — new table
- `packages/db/src/schema/index.ts` — export
- `packages/db/src/schema/permissions.ts` — add `notifications` module
- `packages/db/src/seed.ts` — delete + seed sample notifications
- `apps/store/src/lib/order-finalize.ts` — insert notification on paid order
- `apps/admin/src/lib/notification-broadcaster.ts` — in-memory long-poll wake bus
- `apps/admin/src/lib/notifications.ts` — DB helpers + scope logic
- `apps/admin/src/lib/permissions-shared.ts` — HQ/module labels
- `apps/admin/src/providers/notification-provider.tsx` — long-poll loop + sound + state
- `apps/admin/src/components/NotificationBell.tsx` — bell UI
- `apps/admin/src/components/AdminSidebar.tsx` — add sidebar link
- `apps/admin/src/app/admin/layout.tsx` — wire provider + bell
- `apps/admin/src/app/admin/notifications/layout.tsx` — permission gate
- `apps/admin/src/app/admin/notifications/page.tsx` — full notifications page
- `apps/admin/src/app/api/admin/notifications/*` — API routes
- `docs/api-reference.md` — endpoint docs
- `docs/features/notifications.md` — this document
