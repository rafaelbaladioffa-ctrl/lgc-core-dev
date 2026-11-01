-- Optional cost center allocation for collaborators (nullable, no backfill needed).
ALTER TABLE "collaborators" ADD COLUMN     "cost_center_id" TEXT;

-- CreateIndex
CREATE INDEX "collaborators_cost_center_id_idx" ON "collaborators"("cost_center_id");

-- AddForeignKey
ALTER TABLE "collaborators" ADD CONSTRAINT "collaborators_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
