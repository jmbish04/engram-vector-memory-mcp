PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`tags` text,
	`source_app` text,
	`session_id` text,
	`status` text DEFAULT 'raw',
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_memories`("id", "text", "tags", "source_app", "session_id", "status", "created_at", "updated_at") SELECT "id", "text", "tags", "source_app", "session_id", "status", "created_at", "updated_at" FROM `memories`;--> statement-breakpoint
DROP TABLE `memories`;--> statement-breakpoint
ALTER TABLE `__new_memories` RENAME TO `memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_id_idx` ON `memories` (`session_id`);--> statement-breakpoint
CREATE INDEX `source_app_idx` ON `memories` (`source_app`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `memories` (`status`);