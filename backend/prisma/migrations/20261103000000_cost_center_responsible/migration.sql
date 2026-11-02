ALTER TABLE "cost_centers" ADD COLUMN "responsible_collaborator_id" TEXT;
CREATE INDEX "cost_centers_responsible_collaborator_id_idx" ON "cost_centers"("responsible_collaborator_id");
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_responsible_collaborator_id_fkey" FOREIGN KEY ("responsible_collaborator_id") REFERENCES "collaborators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
