CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`tags` text,
	`source_app` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `session_id_idx` ON `memories` (`session_id`);--> statement-breakpoint
CREATE INDEX `source_app_idx` ON `memories` (`source_app`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `memories` (`created_at`);