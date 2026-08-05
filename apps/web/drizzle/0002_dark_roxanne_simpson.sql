ALTER TABLE "score_history" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "score_history" ADD COLUMN "embedding_dtype" text;--> statement-breakpoint
ALTER TABLE "score_history" ADD COLUMN "scoring_version" text;