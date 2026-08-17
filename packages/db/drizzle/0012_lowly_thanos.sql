ALTER TABLE "user" DROP CONSTRAINT "user_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;