CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_refresh_token_hash_key";--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP CONSTRAINT "auth_accounts_email_password_chk";--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."auth_provider";--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('credential', 'google', 'apple');--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "provider" SET DATA TYPE "public"."auth_provider" USING "provider"::"public"."auth_provider";--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN "refresh_token_hash";--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_token_key" UNIQUE("token");--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_email_password_chk" CHECK (("auth_accounts"."provider" = 'credential' AND "auth_accounts"."password_hash" IS NOT NULL) OR ("auth_accounts"."provider" <> 'credential' AND "auth_accounts"."password_hash" IS NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified_sync_chk" CHECK ("users"."phone_number_verified" = ("users"."phone_verified_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_verified_sync_chk" CHECK ("users"."email_verified" = ("users"."email_verified_at" IS NOT NULL));