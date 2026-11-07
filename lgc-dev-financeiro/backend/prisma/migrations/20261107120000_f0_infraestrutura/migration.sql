-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED', 'PENDING', 'DELIVERED');

-- CreateTable
CREATE TABLE "finance_permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "finance_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "axis_role_to_finance_role" (
    "axis_role" TEXT NOT NULL,
    "finance_role_id" TEXT NOT NULL,

    CONSTRAINT "axis_role_to_finance_role_pkey" PRIMARY KEY ("axis_role","finance_role_id")
);

-- CreateTable
CREATE TABLE "user_finance_roles" (
    "axis_user_id" TEXT NOT NULL,
    "finance_role_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_finance_roles_pkey" PRIMARY KEY ("axis_user_id","finance_role_id")
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

-- CreateTable
CREATE TABLE "integration_messages" (
    "id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "correlation_id" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "integration_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "axis_master_cache" (
    "kind" TEXT NOT NULL,
    "axis_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL DEFAULT '{}',
    "source_occurred_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "axis_master_cache_pkey" PRIMARY KEY ("kind","axis_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_permissions_code_key" ON "finance_permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "finance_roles_code_key" ON "finance_roles"("code");

-- CreateIndex
CREATE INDEX "audit_events_aggregate_type_aggregate_id_idx" ON "audit_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_axis_id_created_at_idx" ON "audit_events"("actor_axis_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_messages_direction_status_next_attempt_at_idx" ON "integration_messages"("direction", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_messages_direction_event_id_key" ON "integration_messages"("direction", "event_id");

-- CreateIndex
CREATE INDEX "axis_master_cache_kind_active_idx" ON "axis_master_cache"("kind", "active");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "finance_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "finance_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "axis_role_to_finance_role" ADD CONSTRAINT "axis_role_to_finance_role_finance_role_id_fkey" FOREIGN KEY ("finance_role_id") REFERENCES "finance_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_finance_roles" ADD CONSTRAINT "user_finance_roles_finance_role_id_fkey" FOREIGN KEY ("finance_role_id") REFERENCES "finance_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Trilha de auditoria append-only: o banco recusa alteração e remoção.
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events é somente inclusão';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
