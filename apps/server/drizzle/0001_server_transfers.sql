CREATE TABLE "server_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"old_node_id" integer NOT NULL,
	"new_node_id" integer NOT NULL,
	"old_allocation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_allocation_id" integer NOT NULL,
	"successful" boolean,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_transfers" ADD CONSTRAINT "server_transfers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_transfers_server_idx" ON "server_transfers" USING btree ("server_id");