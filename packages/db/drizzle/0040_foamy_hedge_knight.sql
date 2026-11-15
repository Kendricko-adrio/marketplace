CREATE TABLE "discount_request_window" (
	"kind" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discount_request_window_kind_subject_hash_window_start_pk" PRIMARY KEY("kind","subject_hash","window_start"),
	CONSTRAINT "discount_request_window_count_valid" CHECK ("discount_request_window"."count" >= 0),
	CONSTRAINT "discount_request_window_subject_valid" CHECK ("discount_request_window"."subject_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "discount_request_window_kind_valid" CHECK ("discount_request_window"."kind" IN ('preview:account','preview:ip','place:account','place:ip')),
	CONSTRAINT "discount_request_window_expiry_valid" CHECK ("discount_request_window"."expires_at" = "discount_request_window"."window_start" + interval '60 seconds')
);
--> statement-breakpoint
CREATE INDEX "discount_request_window_expiry_idx" ON "discount_request_window" USING btree ("expires_at");