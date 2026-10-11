# Delivery Work Navigation

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: none
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

Where should branch staff enter and navigate delivery work, and how should that experience relate to the existing Orders list, Pickup, and delivery follow-up area?

Resolve the product navigation model, not a route implementation:

- Delivery within Orders versus a separate delivery workspace.
- The default landing experience for the agreed branch-operations audience.
- How staff switch between Delivery, Pickup, and general order search/history.
- How the existing follow-up area is discovered without creating duplicate case sources.
- Whether all-branch viewers use the same entry point with their existing scope restrictions.

## Evidence and constraints

- [Proposal](../../../plan/admin-delivery-workflow-proposal.md), delivery operations queue section.
- [Current Orders page](../../../apps/admin/src/app/admin/orders/page.tsx).
- [Current follow-up page](../../../apps/admin/src/app/admin/orders/follow-up/page.tsx).
- [Follow-up rules](../../../docs/features/delivery-follow-up.md).

Branch staff are the primary audience. Pickup must remain available. Visibility does not authorize cross-Home physical actions. The proposal's inside-Orders recommendation is not an owner decision yet.

## Resolution evidence

Record the owner-selected navigation and a short walkthrough: a Bandung staff member opening the admin area at the start of a shift, finding delivery work, opening a blocker, and returning to the queue. Capture what happens to the existing Orders/Pickup entry points.

Do not settle stage vocabulary, queue date/order rules, or final page layout here; those belong to their named children.

## Work boundaries

Read-only local investigation and owner interview; planning-document edits only. Load `grilling`, `domain-modeling`, and `development-workflow`. Claim before working. Do not implement routes or resolve another child in this session.

## Comments

Published after explicit owner approval of the complete map structure.

The owner explicitly approved the complete navigation summary and authorized resolving this decision ticket. No application implementation is authorized.

## Answer

### Owner-selected navigation

- Keep delivery work inside the existing Orders menu; do not introduce a separate delivery workspace.
- Login continues to land on Dashboard. Opening Orders defaults to Delivery with the `Perlu dikerjakan` work filter.
- Use three primary tabs: Delivery / Pickup / Semua. Use one work-filter dropdown rather than an additional row of status tabs, keeping navigation simple and uncrowded.
- Pickup remains available through its tab, with pickup verification accessible in that context. Semua remains the general order search/history entry point.
- Delivery work filtering offers access to actionable work, follow-up, in-transit monitoring and all-delivery search/history. Labels and exact membership rules are not finalized by this navigation ticket.
- The follow-up navigation opens the existing follow-up area, which remains the single case source; do not create a second independent case queue.
- Returning from an order detail or blocker/follow-up restores the preceding work list and its filters.
- Scope-authorized all-branch viewers use the same tabs and default Delivery work view. Existing Branch Scope visibility, branch-scope defaults and Home Branch action restrictions remain unchanged. Visibility never authorizes cross-Home physical actions.

### Start-of-shift walkthrough

A Bandung staff member logs in and reaches Dashboard. They open Orders and immediately see Delivery with `Perlu dikerjakan` selected. They find an order requiring attention and open its detail. If it has a blocker, they can reach the existing follow-up area without creating a duplicate case source. Returning restores their preceding work list and filters. Pickup work is one tab away, including access to pickup verification; general search/history is available through Semua.

An all-branch viewer follows the same navigation, sees only scope-authorized orders, and remains unable to perform physical fulfillment actions outside their Home Branch.

### Boundaries

This resolves navigation only. Stage vocabulary, queue date/order defaults, exact case membership, counts and final page layout remain for their respective specification decisions. No routes, application code or authorization rules have been changed.
