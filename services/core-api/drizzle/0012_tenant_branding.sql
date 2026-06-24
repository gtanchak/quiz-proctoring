ALTER TABLE "organizations" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subdomain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_subdomain_unique" ON "organizations" USING btree ("subdomain");
