CREATE TABLE "settings_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"stopwords" jsonb NOT NULL,
	"term_boosts" jsonb NOT NULL,
	"missing_keyword_settings" jsonb NOT NULL,
	"preference_mismatch_settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "score_history" ADD COLUMN "settings_version_id" uuid;--> statement-breakpoint
ALTER TABLE "settings_versions" ADD CONSTRAINT "settings_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settings_versions_user_hash_idx" ON "settings_versions" USING btree ("user_id","hash");--> statement-breakpoint
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_settings_version_id_settings_versions_id_fk" FOREIGN KEY ("settings_version_id") REFERENCES "public"."settings_versions"("id") ON DELETE set null ON UPDATE no action;