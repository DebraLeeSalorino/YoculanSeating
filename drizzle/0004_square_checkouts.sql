CREATE TYPE "public"."checkout_kind" AS ENUM('terminal', 'link');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('pending', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "checkout_kind" NOT NULL,
	"customer_ids" jsonb NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "checkout_status" DEFAULT 'pending' NOT NULL,
	"device_id" text,
	"square_checkout_id" text,
	"square_order_id" text,
	"url" text,
	"square_payment_id" text,
	"cancel_reason" text,
	"oversold" boolean DEFAULT false NOT NULL,
	"oversold_resolved_at" timestamp with time zone,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "square_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkouts_event_status" ON "checkouts" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "checkouts_square_checkout" ON "checkouts" USING btree ("square_checkout_id");--> statement-breakpoint
CREATE INDEX "checkouts_square_order" ON "checkouts" USING btree ("square_order_id");--> statement-breakpoint
ALTER TABLE "square_connections" DROP COLUMN "encrypted_credentials";