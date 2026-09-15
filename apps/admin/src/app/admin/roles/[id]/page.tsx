import { RoleEditorClient } from "../roles-editor-client";

// =========================================================
// /admin/roles/[id] — Role detail/editor (gate: roles:view via layout)
// =========================================================
// `new` renders the deny-all/clonable draft editor; a real id renders the
// complete-draft editor with optimistic versioning, impact confirmation,
// archive, and restore review.

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleEditorClient roleId={id} />;
}