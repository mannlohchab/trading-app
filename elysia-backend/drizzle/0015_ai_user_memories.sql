CREATE TABLE "ai_user_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_user_memories_content_chk" CHECK (length(btrim("ai_user_memories"."content")) > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_user_memories" ADD CONSTRAINT "ai_user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_user_memories_user_created_idx" ON "ai_user_memories" USING btree ("user_id","created_at");