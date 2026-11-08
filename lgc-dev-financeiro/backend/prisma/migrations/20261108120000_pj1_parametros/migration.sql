-- CreateEnum
CREATE TYPE "ParameterSetStatus" AS ENUM ('rascunho', 'vigente', 'arquivado');

-- CreateTable
CREATE TABLE "parameter_sets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ParameterSetStatus" NOT NULL DEFAULT 'rascunho',
    "effective_from" DATE,
    "notes" TEXT,
    "based_on_id" TEXT,
    "hours_per_day" DECIMAL(6,2),
    "working_days_year" INTEGER,
    "vacation_work_days" INTEGER,
    "inss_rate" DECIMAL(9,6),
    "rat_rate" DECIMAL(9,6),
    "third_party_rate" DECIMAL(9,6),
    "fgts_rate" DECIMAL(9,6),
    "fgts_fine_provision" DECIMAL(9,6),
    "vt_salary_discount" BOOLEAN,
    "pis_rate" DECIMAL(9,6),
    "cofins_rate" DECIMAL(9,6),
    "iss_rate" DECIMAL(9,6),
    "irpj_presumption" DECIMAL(9,6),
    "irpj_rate" DECIMAL(9,6),
    "irpj_surcharge" BOOLEAN,
    "csll_presumption" DECIMAL(9,6),
    "csll_rate" DECIMAL(9,6),
    "km_rate" DECIMAL(14,2),
    "fuel_km_per_liter" DECIMAL(8,2),
    "fuel_price_per_liter" DECIMAL(14,2),
    "vehicle_wear_per_km" DECIMAL(14,4),
    "material_markup" DECIMAL(9,6),
    "rj45_spare_rate" DECIMAL(9,6),
    "platform_monthly_rent" DECIMAL(14,2),
    "platform_days_per_month" INTEGER,
    "platform_freight" DECIMAL(14,2),
    "platform_daily_billed" DECIMAL(14,2),
    "contingency_rate" DECIMAL(9,6),
    "overhead_rate" DECIMAL(9,6),
    "commission_rate" DECIMAL(9,6),
    "receivable_days" INTEGER,
    "money_cost_monthly" DECIMAL(9,6),
    "target_profit_on_cost" DECIMAL(9,6),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_by" TEXT,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_set_roles" (
    "id" TEXT NOT NULL,
    "parameter_set_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_role" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "billing_rate" DECIMAL(14,2),
    "monthly_salary" DECIMAL(14,2),
    "plr_salaries_per_year" DECIMAL(8,4),
    "meal_per_worked_day" DECIMAL(14,2),
    "transport_per_month" DECIMAL(14,2),
    "gym_per_month" DECIMAL(14,2),
    "health_per_month" DECIMAL(14,2),
    "other_benefits_per_month" DECIMAL(14,2),
    "cost_per_hour_override" DECIMAL(14,4),

    CONSTRAINT "parameter_set_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_materials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "part_number" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'un',
    "billed_price" DECIMAL(14,4) NOT NULL,
    "real_cost" DECIMAL(14,4),
    "client_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_destinations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "km_round_trip" DECIMAL(10,2) NOT NULL,
    "toll_per_day" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "route_notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parameter_sets_code_key" ON "parameter_sets"("code");

-- CreateIndex
CREATE INDEX "parameter_sets_status_idx" ON "parameter_sets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_set_roles_parameter_set_id_role_key_key" ON "parameter_set_roles"("parameter_set_id", "role_key");

-- CreateIndex
CREATE UNIQUE INDEX "budget_materials_name_key" ON "budget_materials"("name");

-- CreateIndex
CREATE UNIQUE INDEX "budget_destinations_name_key" ON "budget_destinations"("name");

-- AddForeignKey
ALTER TABLE "parameter_set_roles" ADD CONSTRAINT "parameter_set_roles_parameter_set_id_fkey" FOREIGN KEY ("parameter_set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Código PAR-NNNN.
CREATE SEQUENCE parameter_set_code_seq START 1;

-- No máximo um conjunto vigente e um rascunho por vez.
CREATE UNIQUE INDEX parameter_sets_one_vigente ON "parameter_sets" ("status") WHERE "status" = 'vigente';
CREATE UNIQUE INDEX parameter_sets_one_rascunho ON "parameter_sets" ("status") WHERE "status" = 'rascunho';

-- Conjunto publicado é imutável: só pode passar de vigente para arquivado. Nada é apagado.
CREATE FUNCTION parameter_sets_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conjunto de parâmetros não pode ser apagado';
  END IF;
  IF OLD.status = 'rascunho' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'vigente' AND NEW.status = 'arquivado'
     AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by') = (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'conjunto de parâmetros publicado é imutável';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parameter_sets_immutable
  BEFORE UPDATE OR DELETE ON "parameter_sets"
  FOR EACH ROW EXECUTE FUNCTION parameter_sets_guard();

-- Funções só mudam enquanto o conjunto é rascunho.
CREATE FUNCTION parameter_set_roles_guard() RETURNS trigger AS $$
DECLARE
  set_id TEXT;
  set_status "ParameterSetStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    set_id := OLD.parameter_set_id;
  ELSE
    set_id := NEW.parameter_set_id;
  END IF;
  SELECT status INTO set_status FROM "parameter_sets" WHERE id = set_id;
  IF set_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'funções de conjunto publicado são imutáveis';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parameter_set_roles_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "parameter_set_roles"
  FOR EACH ROW EXECUTE FUNCTION parameter_set_roles_guard();
