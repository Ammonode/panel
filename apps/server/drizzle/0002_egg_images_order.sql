ALTER TABLE "eggs" ALTER COLUMN "docker_images" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "eggs" ALTER COLUMN "docker_images" SET DEFAULT '{}'::json;