-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "consumed_qty" DECIMAL(18,6) NOT NULL DEFAULT 0;
