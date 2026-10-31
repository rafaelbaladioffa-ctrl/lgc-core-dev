-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('CONSUMO', 'FERRAMENTA', 'EQUIPAMENTO', 'ATIVO', 'EMBALAGEM', 'QUIMICO', 'EPI', 'EPC', 'SOBRESSALENTE');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ATIVO', 'INATIVO', 'SUBSTITUIDO');

-- CreateEnum
CREATE TYPE "ExitMethod" AS ENUM ('FIFO', 'FEFO', 'SERIE_ESPECIFICA');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "DemandClass" AS ENUM ('X', 'Y', 'Z');

-- CreateEnum
CREATE TYPE "UomDimension" AS ENUM ('UNIDADE', 'MASSA', 'VOLUME', 'COMPRIMENTO', 'AREA', 'EMBALAGEM');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL', 'UNIDADE', 'PROJETO', 'TEMPORARIO', 'VEICULO', 'CONSIGNACAO', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "WarehouseStatus" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "LocationLevel" AS ENUM ('AREA', 'CORREDOR', 'ESTANTE', 'NIVEL', 'POSICAO');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ATIVO', 'BLOQUEADO', 'INATIVO');

-- CreateEnum
CREATE TYPE "CapacityKind" AS ENUM ('PESO', 'VOLUME', 'QUANTIDADE', 'CLASSE');

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" "UomDimension" NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" TEXT NOT NULL,
    "material_id" TEXT,
    "from_uom_id" TEXT NOT NULL,
    "to_uom_id" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "technical_description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "type" "MaterialType" NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'ATIVO',
    "stock_uom_id" TEXT NOT NULL,
    "replaced_by_id" TEXT,
    "manufacturer" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "manufacturer_code" TEXT,
    "ncm" TEXT,
    "cest" TEXT,
    "fiscal_origin" TEXT,
    "lot_controlled" BOOLEAN NOT NULL DEFAULT false,
    "expiry_controlled" BOOLEAN NOT NULL DEFAULT false,
    "min_shelf_life_days" INTEGER,
    "serial_controlled" BOOLEAN NOT NULL DEFAULT false,
    "asset_tagged" BOOLEAN NOT NULL DEFAULT false,
    "requires_certificate" BOOLEAN NOT NULL DEFAULT false,
    "requires_calibration" BOOLEAN NOT NULL DEFAULT false,
    "requires_ca" BOOLEAN NOT NULL DEFAULT false,
    "has_size_grid" BOOLEAN NOT NULL DEFAULT false,
    "weight_kg" DECIMAL(12,4),
    "length_cm" DECIMAL(10,2),
    "width_cm" DECIMAL(10,2),
    "height_cm" DECIMAL(10,2),
    "storage_condition" TEXT,
    "risk_class" TEXT,
    "exit_method" "ExitMethod" NOT NULL DEFAULT 'FIFO',
    "purchase_multiple" DECIMAL(18,6),
    "lead_time_days" INTEGER,
    "criticality" "Criticality" NOT NULL DEFAULT 'C',
    "demand_class" "DemandClass",
    "requires_authorization" BOOLEAN NOT NULL DEFAULT false,
    "authorization_by" TEXT,
    "returnable" BOOLEAN NOT NULL DEFAULT false,
    "repairable" BOOLEAN NOT NULL DEFAULT false,
    "calibratable" BOOLEAN NOT NULL DEFAULT false,
    "leased" BOOLEAN NOT NULL DEFAULT false,
    "disposable" BOOLEAN NOT NULL DEFAULT false,
    "average_cost" DECIMAL(18,4),
    "last_cost" DECIMAL(18,4),
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_versions" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_reason" TEXT,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_barcodes" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GTIN',
    "uom_id" TEXT,
    "factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ATIVO',
    "company_axis_id" TEXT,
    "unit_axis_id" TEXT,
    "project_axis_id" TEXT,
    "responsible_axis_user_id" TEXT,
    "address_text" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "level" "LocationLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "status" "LocationStatus" NOT NULL DEFAULT 'ATIVO',
    "blocked_reason" TEXT,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "capacity_kind" "CapacityKind",
    "capacity_value" DECIMAL(18,4),
    "allowed_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_risk_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "temperature_min" DECIMAL(6,2),
    "temperature_max" DECIMAL(6,2),
    "restricted_access" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "logistics_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "axis_role_to_logistics_role" (
    "axis_role" TEXT NOT NULL,
    "logistics_role_id" TEXT NOT NULL,

    CONSTRAINT "axis_role_to_logistics_role_pkey" PRIMARY KEY ("axis_role","logistics_role_id")
);

-- CreateTable
CREATE TABLE "user_warehouse_access" (
    "axis_user_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY ("axis_user_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_axis_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "diff" JSONB,
    "origin" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_code_key" ON "units_of_measure"("code");

-- CreateIndex
CREATE INDEX "unit_conversions_material_id_from_uom_id_to_uom_id_idx" ON "unit_conversions"("material_id", "from_uom_id", "to_uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_category_subcategory_idx" ON "materials"("category", "subcategory");

-- CreateIndex
CREATE INDEX "materials_type_idx" ON "materials"("type");

-- CreateIndex
CREATE INDEX "materials_status_idx" ON "materials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_material_id_version_key" ON "material_versions"("material_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "material_barcodes_code_key" ON "material_barcodes"("code");

-- CreateIndex
CREATE INDEX "material_barcodes_material_id_idx" ON "material_barcodes"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "locations_warehouse_id_parent_id_idx" ON "locations"("warehouse_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_warehouse_id_code_key" ON "locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_roles_code_key" ON "logistics_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_permissions_code_key" ON "logistics_permissions"("code");

-- CreateIndex
CREATE INDEX "audit_events_aggregate_type_aggregate_id_idx" ON "audit_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_axis_id_created_at_idx" ON "audit_events"("actor_axis_id", "created_at");

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_uom_id_fkey" FOREIGN KEY ("from_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_uom_id_fkey" FOREIGN KEY ("to_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_stock_uom_id_fkey" FOREIGN KEY ("stock_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_barcodes" ADD CONSTRAINT "material_barcodes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "logistics_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "logistics_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "axis_role_to_logistics_role" ADD CONSTRAINT "axis_role_to_logistics_role_logistics_role_id_fkey" FOREIGN KEY ("logistics_role_id") REFERENCES "logistics_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
