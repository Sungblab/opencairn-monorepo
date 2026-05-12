CREATE TABLE "source_pdf_annotations" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"annotations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_pdf_annotations" ADD CONSTRAINT "source_pdf_annotations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pdf_annotations" ADD CONSTRAINT "source_pdf_annotations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pdf_annotations" ADD CONSTRAINT "source_pdf_annotations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pdf_annotations" ADD CONSTRAINT "source_pdf_annotations_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_pdf_annotations_workspace_project_idx" ON "source_pdf_annotations" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "source_pdf_annotations_updated_by_idx" ON "source_pdf_annotations" USING btree ("updated_by");
