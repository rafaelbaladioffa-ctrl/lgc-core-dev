-- P02 is additive. Does not touch legacy requests or P01 state.
-- Adds support for: returnForCorrection, saveCorrection, resubmit,
--                   requestInformation, respondInformation.
-- All new columns are nullable to preserve backward compatibility.

-- New request statuses for P02 flows
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'aguardando_correcao';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'aguardando_informacao';

-- Extra columns on bpm_activity_instances for correction and information flows
ALTER TABLE "bpm_activity_instances"
  ADD COLUMN IF NOT EXISTS "correction_field_keys" JSONB,
  ADD COLUMN IF NOT EXISTS "question" TEXT,
  ADD COLUMN IF NOT EXISTS "information_due_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parent_activity_id" TEXT;

ALTER TABLE "bpm_activity_instances"
  ADD CONSTRAINT "bpm_activity_instances_parent_activity_id_fkey"
  FOREIGN KEY ("parent_activity_id")
  REFERENCES "bpm_activity_instances"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
