INSERT INTO "permission" (
	"id",
	"role",
	"module",
	"can_view",
	"can_edit",
	"can_delete",
	"created_at",
	"updated_at"
)
VALUES (
	'permission-admin-customers',
	'admin',
	'customers',
	false,
	false,
	false,
	now(),
	now()
)
ON CONFLICT ("role", "module") DO NOTHING;
