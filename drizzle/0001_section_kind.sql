CREATE TYPE "public"."section_kind" AS ENUM('general', 'sponsors', 'seller_ff', 'committee_ff', 'custom');--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "kind" "section_kind" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
UPDATE "sections" SET "kind" = 'general' WHERE "name" = 'General';--> statement-breakpoint
UPDATE "sections" SET "kind" = 'sponsors' WHERE "name" = 'Sponsors';--> statement-breakpoint
UPDATE "sections" SET "kind" = 'seller_ff' WHERE "name" = 'Seller friends and family';--> statement-breakpoint
UPDATE "sections" SET "kind" = 'committee_ff' WHERE "name" = 'Committee friends and family';
