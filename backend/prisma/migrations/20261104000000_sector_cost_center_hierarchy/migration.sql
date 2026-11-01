-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "parent_sector_id" TEXT;

-- AlterTable
ALTER TABLE "cost_centers" ADD COLUMN     "parent_cost_center_id" TEXT;

-- CreateIndex
CREATE INDEX "sectors_parent_sector_id_idx" ON "sectors"("parent_sector_id");

-- CreateIndex
CREATE INDEX "cost_centers_parent_cost_center_id_idx" ON "cost_centers"("parent_cost_center_id");

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_parent_sector_id_fkey" FOREIGN KEY ("parent_sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_cost_center_id_fkey" FOREIGN KEY ("parent_cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Native atomic sequences for root-level codes (see PLANNING.md 5.5/5.6): multiples of 100,
-- same spacing convention as classic accounting chart-of-account numbering, leaving room to
-- insert new root sectors/cost-centers later without renumbering. Child codes are NOT generated
-- from a sequence — Postgres sequences are global/pre-declared and can't restart at 1 per parent,
-- so SectorsService/CostCentersService instead lock the parent row (SELECT ... FOR UPDATE) inside
-- the creating transaction and derive "<parent.code>.<n>" from a COUNT of existing children,
-- which serializes concurrent siblings under the same parent just as effectively.
-- Existing sector/cost-center codes (free text from before this migration, e.g. "ADM") are left
-- untouched — the new generation scheme only applies to rows created from here on.
CREATE SEQUENCE IF NOT EXISTS "sector_root_code_seq" START WITH 100 INCREMENT BY 100;
CREATE SEQUENCE IF NOT EXISTS "cost_center_root_code_seq" START WITH 100 INCREMENT BY 100;
