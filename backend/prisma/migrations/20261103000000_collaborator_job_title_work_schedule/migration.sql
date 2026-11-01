-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('masculino', 'feminino', 'outro', 'prefiro_nao_informar');

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_technician" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_titles_name_key" ON "job_titles"("name");

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_minutes" INTEGER,
    "days_of_week" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- Fallback job title so the UI/seed always has something to point unmapped collaborators at.
INSERT INTO "job_titles" ("id", "name", "is_technician", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'A definir', false, now(), now());

-- Backfill job_titles from the existing free-text collaborators.job_title values. A title is
-- marked technician if ANY existing collaborator holding it had is_technician = true, so no one
-- who needed the NR-certification section loses it in the move to a shared JobTitle record.
INSERT INTO "job_titles" ("id", "name", "is_technician", "created_at", "updated_at")
SELECT gen_random_uuid(), "job_title", bool_or("is_technician"), now(), now()
FROM "collaborators"
GROUP BY "job_title"
ON CONFLICT ("name") DO NOTHING;

-- AlterTable: add the new columns nullable first (backfilled below, then constrained).
ALTER TABLE "collaborators"
  ADD COLUMN "corporate_email" TEXT,
  ADD COLUMN "personal_email" TEXT,
  ADD COLUMN "job_title_id" TEXT,
  ADD COLUMN "work_schedule_id" TEXT,
  ADD COLUMN "cnh_number" TEXT,
  ADD COLUMN "yellow_badge_new" TEXT,
  ADD COLUMN "gender_new" "Gender";

UPDATE "collaborators" SET "corporate_email" = "email";

UPDATE "collaborators" c
SET "job_title_id" = jt."id"
FROM "job_titles" jt
WHERE c."job_title" = jt."name";

-- Best-effort mapping of the old free-text gender into the new enum; anything that doesn't match
-- one of the four labels (case/accent-insensitively) is left NULL rather than guessed at.
UPDATE "collaborators"
SET "gender_new" = CASE lower(trim("gender"))
  WHEN 'masculino' THEN 'masculino'::"Gender"
  WHEN 'feminino' THEN 'feminino'::"Gender"
  WHEN 'outro' THEN 'outro'::"Gender"
  WHEN 'prefiro nao informar' THEN 'prefiro_nao_informar'::"Gender"
  WHEN 'prefiro_nao_informar' THEN 'prefiro_nao_informar'::"Gender"
  ELSE NULL
END
WHERE "gender" IS NOT NULL;

-- yellow_badge changes meaning from a boolean flag to the actual badge/login identifier string —
-- there is no real identifier value to carry forward from a true/false flag, so this is a
-- deliberate reset to NULL rather than a lossy type cast (e.g. 'true'/'false' as text would be
-- actively misleading as a "badge id").

-- Drop the old columns now that everything needed from them has been read.
ALTER TABLE "collaborators"
  DROP COLUMN "email",
  DROP COLUMN "job_title",
  DROP COLUMN "is_technician",
  DROP COLUMN "work_schedule",
  DROP COLUMN "yellow_badge",
  DROP COLUMN "gender";

ALTER TABLE "collaborators" RENAME COLUMN "yellow_badge_new" TO "yellow_badge";
ALTER TABLE "collaborators" RENAME COLUMN "gender_new" TO "gender";

ALTER TABLE "collaborators" ALTER COLUMN "corporate_email" SET NOT NULL;
ALTER TABLE "collaborators" ALTER COLUMN "job_title_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "collaborators_corporate_email_key" ON "collaborators"("corporate_email");
CREATE INDEX "collaborators_job_title_id_idx" ON "collaborators"("job_title_id");
CREATE INDEX "collaborators_work_schedule_id_idx" ON "collaborators"("work_schedule_id");

-- AddForeignKey
ALTER TABLE "collaborators" ADD CONSTRAINT "collaborators_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaborators" ADD CONSTRAINT "collaborators_work_schedule_id_fkey" FOREIGN KEY ("work_schedule_id") REFERENCES "work_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
