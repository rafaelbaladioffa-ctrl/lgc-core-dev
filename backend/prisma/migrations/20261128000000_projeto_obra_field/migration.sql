-- Obra do projeto no Field (PT-09 do plano projeto aprovado -> obra). Aditiva: uma tabela nova, sem tocar nas existentes.

-- CreateTable
CREATE TABLE "project_field_works" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "field_project_id" TEXT NOT NULL,
    "field_project_code" TEXT,
    "url" TEXT,
    "sow_plan_status" TEXT,
    "tasks_count" INTEGER,
    "created_in_field_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "progress_date" DATE,
    "progress_event_at" TIMESTAMP(3),
    "percent_complete" DECIMAL(5,2),
    "tasks_total" INTEGER,
    "tasks_done" INTEGER,
    "real_man_hours" DECIMAL(12,2),
    "planned_man_hours" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_field_works_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_field_works_project_id_key" ON "project_field_works"("project_id");

-- AddForeignKey
ALTER TABLE "project_field_works" ADD CONSTRAINT "project_field_works_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
