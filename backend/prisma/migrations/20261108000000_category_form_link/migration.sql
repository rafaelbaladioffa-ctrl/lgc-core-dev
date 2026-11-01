-- Link ticket_categories to ticket_forms directly (PLANNING.md 4.6.3): one custom opening form
-- per category, replacing per-sector form resolution. ticket_forms.sector_id stays as admin-only
-- grouping, no longer used to resolve a ticket's form.

ALTER TABLE "ticket_categories" ADD COLUMN "form_id" TEXT;

CREATE INDEX "ticket_categories_form_id_idx" ON "ticket_categories"("form_id");

ALTER TABLE "ticket_categories"
  ADD CONSTRAINT "ticket_categories_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "ticket_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
