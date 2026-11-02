-- P01 is additive. It does not delete or rewrite legacy requests.
INSERT INTO "permissions" ("id", "resource", "action", "description") VALUES
  (gen_random_uuid()::text, 'request_process', 'model', 'Configurar processos BPM'),
  (gen_random_uuid()::text, 'request_process', 'publish', 'Publicar processos BPM'),
  (gen_random_uuid()::text, 'request_process', 'operate', 'Operar atividades BPM'),
  (gen_random_uuid()::text, 'request_process', 'audit', 'Auditar processos BPM'),
  (gen_random_uuid()::text, 'request_queue', 'manage', 'Gerenciar filas BPM')
ON CONFLICT ("resource", "action") DO NOTHING;

CREATE TYPE "RequestExecutionMode" AS ENUM ('legacy','bpm_v1');
CREATE TYPE "BpmVersionStatus" AS ENUM ('draft','published','retired');
CREATE TYPE "BpmQueueMemberRole" AS ENUM ('member','manager');
CREATE TYPE "BpmGrantRole" AS ENUM ('modeler','publisher','operator','auditor');
CREATE TYPE "BpmInstanceState" AS ENUM ('draft','running','completed','closed','cancelled');
CREATE TYPE "BpmTokenState" AS ENUM ('active','waiting','consumed','cancelled');
CREATE TYPE "BpmActivityKind" AS ENUM ('human');
CREATE TYPE "BpmActivityPhase" AS ENUM ('triage','execution');
CREATE TYPE "BpmActivityState" AS ENUM ('available','claimed','completed','cancelled');
CREATE TYPE "BpmIncidentState" AS ENUM ('open','resolved');
CREATE TYPE "BpmSlaMetric" AS ENUM ('first_response','resolution');

ALTER TABLE "request_categories" ADD COLUMN "runtime_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "request_categories" ADD COLUMN "config_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "request_categories" ADD COLUMN "published_bpm_version_id" TEXT;
ALTER TABLE "request_categories" ADD CONSTRAINT "request_categories_published_bpm_version_id_fkey" FOREIGN KEY ("published_bpm_version_id") REFERENCES "category_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "category_versions" ADD COLUMN "bpm_status" "BpmVersionStatus";
ALTER TABLE "category_versions" ADD COLUMN "bpm_definition" JSONB;
ALTER TABLE "category_versions" ADD COLUMN "bpm_content_hash" TEXT;
ALTER TABLE "category_versions" ADD COLUMN "bpm_validated_hash" TEXT;
ALTER TABLE "category_versions" ADD COLUMN "bpm_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "category_versions" ADD COLUMN "bpm_calendar_snapshot" JSONB;
ALTER TABLE "category_versions" ALTER COLUMN "published_at" DROP NOT NULL;
ALTER TABLE "category_versions" ALTER COLUMN "published_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "queues" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "queues" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "requests" ADD COLUMN "execution_mode" "RequestExecutionMode" NOT NULL DEFAULT 'legacy';
ALTER TABLE "requests" ADD COLUMN "current_cycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "requests" ADD COLUMN "requester_sector_id" TEXT;
ALTER TABLE "requests" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "requests" ADD COLUMN "first_response_at" TIMESTAMP(3);

CREATE TABLE "request_queue_members" ("id" TEXT NOT NULL, "queue_id" TEXT NOT NULL, "collaborator_id" TEXT NOT NULL, "role" "BpmQueueMemberRole" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ends_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "request_queue_members_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "request_queue_members_queue_id_collaborator_id_role_key" ON "request_queue_members"("queue_id","collaborator_id","role");
CREATE INDEX "request_queue_members_queue_id_active_idx" ON "request_queue_members"("queue_id","active");
CREATE INDEX "request_queue_members_collaborator_id_active_idx" ON "request_queue_members"("collaborator_id","active");
CREATE TABLE "process_config_grants" ("id" TEXT NOT NULL, "category_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "role" "BpmGrantRole" NOT NULL, "expires_at" TIMESTAMP(3), "restricted_read" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "process_config_grants_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "process_config_grants_category_id_user_id_role_key" ON "process_config_grants"("category_id","user_id","role");
CREATE INDEX "process_config_grants_user_id_role_idx" ON "process_config_grants"("user_id","role");

CREATE TABLE "bpm_process_instances" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "cycle" INTEGER NOT NULL, "category_version_id" TEXT NOT NULL, "state" "BpmInstanceState" NOT NULL DEFAULT 'draft', "definition_snapshot" JSONB NOT NULL, "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "closed_at" TIMESTAMP(3), "last_event_sequence" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "bpm_process_instances_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_process_instances_request_id_cycle_key" ON "bpm_process_instances"("request_id","cycle");
CREATE INDEX "bpm_process_instances_request_id_state_idx" ON "bpm_process_instances"("request_id","state");
CREATE TABLE "bpm_execution_tokens" ("id" TEXT NOT NULL, "instance_id" TEXT NOT NULL, "node_id" TEXT NOT NULL, "state" "BpmTokenState" NOT NULL DEFAULT 'active', "activation_key" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_execution_tokens_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_execution_tokens_instance_id_activation_key_key" ON "bpm_execution_tokens"("instance_id","activation_key");
CREATE INDEX "bpm_execution_tokens_instance_id_state_idx" ON "bpm_execution_tokens"("instance_id","state");
CREATE TABLE "bpm_activity_instances" ("id" TEXT NOT NULL, "instance_id" TEXT NOT NULL, "node_id" TEXT NOT NULL, "token_id" TEXT NOT NULL, "activation_key" TEXT NOT NULL, "kind" "BpmActivityKind" NOT NULL DEFAULT 'human', "phase" "BpmActivityPhase" NOT NULL, "state" "BpmActivityState" NOT NULL DEFAULT 'available', "queue_id" TEXT, "assignee_id" TEXT, "round" INTEGER NOT NULL DEFAULT 1, "input_revision" INTEGER NOT NULL DEFAULT 0, "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimed_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "outcome" TEXT, "resolution" TEXT, CONSTRAINT "bpm_activity_instances_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_activity_instances_instance_id_activation_key_key" ON "bpm_activity_instances"("instance_id","activation_key");
CREATE INDEX "bpm_activity_instances_queue_id_state_opened_at_id_idx" ON "bpm_activity_instances"("queue_id","state","opened_at","id");
CREATE INDEX "bpm_activity_instances_assignee_id_state_opened_at_id_idx" ON "bpm_activity_instances"("assignee_id","state","opened_at","id");
CREATE TABLE "bpm_activity_candidates" ("id" TEXT NOT NULL, "activity_id" TEXT NOT NULL, "collaborator_id" TEXT NOT NULL, "source_resolver" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_activity_candidates_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_activity_candidates_activity_id_collaborator_id_source_resolver_key" ON "bpm_activity_candidates"("activity_id","collaborator_id","source_resolver");
CREATE INDEX "bpm_activity_candidates_collaborator_id_activity_id_idx" ON "bpm_activity_candidates"("collaborator_id","activity_id");
CREATE TABLE "bpm_activity_assignments" ("id" TEXT NOT NULL, "activity_id" TEXT NOT NULL, "from_collaborator_id" TEXT, "to_collaborator_id" TEXT, "by_user_id" TEXT NOT NULL, "reason" TEXT, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMP(3), CONSTRAINT "bpm_activity_assignments_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_activity_assignments_activity_id_ended_at_idx" ON "bpm_activity_assignments"("activity_id","ended_at");
CREATE TABLE "bpm_request_participants" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "cycle" INTEGER NOT NULL, "collaborator_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "source_activity_id" TEXT, "field_scope" JSONB, "restricted_allowed" BOOLEAN NOT NULL DEFAULT false, "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ends_at" TIMESTAMP(3), CONSTRAINT "bpm_request_participants_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_request_participants_request_id_cycle_idx" ON "bpm_request_participants"("request_id","cycle");
CREATE TABLE "bpm_runtime_events" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "instance_id" TEXT, "cycle" INTEGER NOT NULL, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL, "actor_user_id" TEXT, "actor_collaborator_id" TEXT, "command_id" TEXT NOT NULL, "correlation_id" TEXT, "summary" JSONB NOT NULL, "visibility" TEXT NOT NULL DEFAULT 'participant', "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_runtime_events_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_runtime_events_request_id_sequence_key" ON "bpm_runtime_events"("request_id","sequence");
CREATE INDEX "bpm_runtime_events_request_id_occurred_at_idx" ON "bpm_runtime_events"("request_id","occurred_at");
CREATE TABLE "bpm_command_receipts" ("id" TEXT NOT NULL, "command_id" TEXT NOT NULL, "actor_user_id" TEXT NOT NULL, "key" TEXT NOT NULL, "route_scope" TEXT NOT NULL, "request_hash" TEXT NOT NULL, "request_id" TEXT, "status_code" INTEGER NOT NULL, "result_ref" JSONB NOT NULL, "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_command_receipts_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_command_receipts_actor_user_id_key_key" ON "bpm_command_receipts"("actor_user_id","key");
CREATE TABLE "bpm_runtime_incidents" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "instance_id" TEXT, "activity_id" TEXT, "type" TEXT NOT NULL, "state" "BpmIncidentState" NOT NULL DEFAULT 'open', "effect_key" TEXT, "safe_details" JSONB NOT NULL, "resolved_by" TEXT, "resolved_at" TIMESTAMP(3), "resolution" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_runtime_incidents_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_runtime_incidents_request_id_state_idx" ON "bpm_runtime_incidents"("request_id","state");
CREATE TABLE "bpm_sla_clocks" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "instance_id" TEXT NOT NULL, "activity_id" TEXT, "metric" "BpmSlaMetric" NOT NULL, "activation_key" TEXT NOT NULL, "calendar_snapshot" JSONB NOT NULL, "budget_seconds" INTEGER NOT NULL, "elapsed_seconds" INTEGER NOT NULL DEFAULT 0, "checkpoint_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "original_target_at" TIMESTAMP(3) NOT NULL, "target_at" TIMESTAMP(3), "stopped_at" TIMESTAMP(3), "breached_at" TIMESTAMP(3), CONSTRAINT "bpm_sla_clocks_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bpm_sla_clocks_instance_id_metric_activation_key_key" ON "bpm_sla_clocks"("instance_id","metric","activation_key");
CREATE TABLE "bpm_sla_intervals" ("id" TEXT NOT NULL, "clock_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "start_at" TIMESTAMP(3) NOT NULL, "end_at" TIMESTAMP(3), "reason" TEXT, "actor_user_id" TEXT, CONSTRAINT "bpm_sla_intervals_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_sla_intervals_clock_id_end_at_idx" ON "bpm_sla_intervals"("clock_id","end_at");
CREATE TABLE "bpm_request_comments" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "activity_id" TEXT, "author_user_id" TEXT NOT NULL, "author_collaborator_id" TEXT, "body" TEXT NOT NULL, "visibility" "RequestCommentVisibility" NOT NULL DEFAULT 'publico', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_request_comments_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_request_comments_request_id_created_at_idx" ON "bpm_request_comments"("request_id","created_at");
CREATE TABLE "bpm_request_attachments" ("id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "activity_id" TEXT, "filename" TEXT NOT NULL, "safe_filename" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "content_hash" TEXT NOT NULL, "content" BYTEA NOT NULL, "field_key" TEXT, "version" INTEGER NOT NULL DEFAULT 1, "previous_id" TEXT, "uploaded_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bpm_request_attachments_pkey" PRIMARY KEY ("id"));
CREATE INDEX "bpm_request_attachments_request_id_idx" ON "bpm_request_attachments"("request_id");

CREATE INDEX "requests_execution_mode_requester_id_created_at_id_idx" ON "requests"("execution_mode","requester_id","created_at","id");
CREATE INDEX "requests_execution_mode_queue_id_status_created_at_id_idx" ON "requests"("execution_mode","queue_id","status","created_at","id");
CREATE INDEX "requests_execution_mode_category_version_id_status_idx" ON "requests"("execution_mode","category_version_id","status");

ALTER TABLE "request_queue_members" ADD CONSTRAINT "request_queue_members_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_queue_members" ADD CONSTRAINT "request_queue_members_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_config_grants" ADD CONSTRAINT "process_config_grants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "request_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_config_grants" ADD CONSTRAINT "process_config_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_process_instances" ADD CONSTRAINT "bpm_process_instances_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_process_instances" ADD CONSTRAINT "bpm_process_instances_category_version_id_fkey" FOREIGN KEY ("category_version_id") REFERENCES "category_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bpm_execution_tokens" ADD CONSTRAINT "bpm_execution_tokens_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "bpm_process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_instances" ADD CONSTRAINT "bpm_activity_instances_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "bpm_process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_instances" ADD CONSTRAINT "bpm_activity_instances_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "bpm_execution_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_instances" ADD CONSTRAINT "bpm_activity_instances_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_instances" ADD CONSTRAINT "bpm_activity_instances_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "collaborators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_candidates" ADD CONSTRAINT "bpm_activity_candidates_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_candidates" ADD CONSTRAINT "bpm_activity_candidates_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bpm_activity_assignments" ADD CONSTRAINT "bpm_activity_assignments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_participants" ADD CONSTRAINT "bpm_request_participants_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_participants" ADD CONSTRAINT "bpm_request_participants_source_activity_id_fkey" FOREIGN KEY ("source_activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bpm_runtime_events" ADD CONSTRAINT "bpm_runtime_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_runtime_events" ADD CONSTRAINT "bpm_runtime_events_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "bpm_process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_command_receipts" ADD CONSTRAINT "bpm_command_receipts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_runtime_incidents" ADD CONSTRAINT "bpm_runtime_incidents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_runtime_incidents" ADD CONSTRAINT "bpm_runtime_incidents_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "bpm_process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_runtime_incidents" ADD CONSTRAINT "bpm_runtime_incidents_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_sla_clocks" ADD CONSTRAINT "bpm_sla_clocks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_sla_clocks" ADD CONSTRAINT "bpm_sla_clocks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "bpm_process_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_sla_clocks" ADD CONSTRAINT "bpm_sla_clocks_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_sla_intervals" ADD CONSTRAINT "bpm_sla_intervals_clock_id_fkey" FOREIGN KEY ("clock_id") REFERENCES "bpm_sla_clocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_comments" ADD CONSTRAINT "bpm_request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_comments" ADD CONSTRAINT "bpm_request_comments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_attachments" ADD CONSTRAINT "bpm_request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bpm_request_attachments" ADD CONSTRAINT "bpm_request_attachments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "bpm_activity_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BPM snapshots are immutable after publication; legacy versions retain their producers.
CREATE FUNCTION bpm_immutable_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.bpm_status = 'published' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BPM_PUBLISHED_VERSION_IMMUTABLE'; END IF;
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'BPM_PUBLISHED_VERSION_IMMUTABLE'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bpm_version_immutability BEFORE UPDATE OR DELETE ON category_versions FOR EACH ROW EXECUTE FUNCTION bpm_immutable_published_version();

CREATE FUNCTION bpm_validate_published_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.published_bpm_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM category_versions v WHERE v.id = NEW.published_bpm_version_id AND v.category_id = NEW.id AND v.bpm_status = 'published'
  ) THEN RAISE EXCEPTION 'BPM_INVALID_PUBLISHED_POINTER'; END IF;
  IF NEW.runtime_enabled AND NEW.published_bpm_version_id IS NULL THEN RAISE EXCEPTION 'BPM_PUBLISHED_POINTER_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bpm_published_pointer BEFORE INSERT OR UPDATE ON request_categories FOR EACH ROW EXECUTE FUNCTION bpm_validate_published_pointer();

-- A cascading parent delete must never erase operational history.
CREATE FUNCTION bpm_preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BPM_HISTORY_DELETE_FORBIDDEN';
END $$;
CREATE TRIGGER bpm_preserve_instance BEFORE DELETE ON bpm_process_instances FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_activity BEFORE DELETE ON bpm_activity_instances FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_event BEFORE DELETE ON bpm_runtime_events FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_attachment BEFORE DELETE ON bpm_request_attachments FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_comment BEFORE DELETE ON bpm_request_comments FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_clock BEFORE DELETE ON bpm_sla_clocks FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_token BEFORE DELETE ON bpm_execution_tokens FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_candidate BEFORE DELETE ON bpm_activity_candidates FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_assignment BEFORE DELETE ON bpm_activity_assignments FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_participant BEFORE DELETE ON bpm_request_participants FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_incident BEFORE DELETE ON bpm_runtime_incidents FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
CREATE TRIGGER bpm_preserve_interval BEFORE DELETE ON bpm_sla_intervals FOR EACH ROW EXECUTE FUNCTION bpm_preserve_history();
ALTER TABLE bpm_sla_clocks ADD CONSTRAINT bpm_sla_budget_positive CHECK (budget_seconds > 0 AND elapsed_seconds >= 0);
ALTER TABLE bpm_request_attachments ADD CONSTRAINT bpm_attachment_size_positive CHECK (size_bytes > 0 AND size_bytes <= 26214400 AND version >= 1);
ALTER TABLE bpm_runtime_events ADD CONSTRAINT bpm_event_sequence_positive CHECK (sequence > 0);
ALTER TABLE bpm_process_instances ADD CONSTRAINT bpm_cycle_positive CHECK (cycle > 0);
ALTER TABLE category_versions ADD CONSTRAINT bpm_draft_not_published CHECK (bpm_status IS DISTINCT FROM 'draft' OR published_at IS NULL);
CREATE INDEX "bpm_activity_instances_instance_id_state_idx" ON "bpm_activity_instances"("instance_id","state");
CREATE INDEX "bpm_sla_clocks_request_id_metric_idx" ON "bpm_sla_clocks"("request_id","metric");
CREATE FUNCTION bpm_request_executor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status "BpmVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.execution_mode = 'bpm_v1' THEN RAISE EXCEPTION 'BPM_HISTORY_DELETE_FORBIDDEN'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN RAISE EXCEPTION 'BPM_EXECUTOR_IMMUTABLE'; END IF;
    IF OLD.execution_mode = 'bpm_v1' AND OLD.category_version_id IS DISTINCT FROM NEW.category_version_id THEN RAISE EXCEPTION 'BPM_VERSION_BINDING_IMMUTABLE'; END IF;
  END IF;
  SELECT bpm_status INTO version_status FROM category_versions WHERE id = NEW.category_version_id;
  IF NEW.execution_mode = 'legacy' AND version_status IS NOT NULL THEN RAISE EXCEPTION 'WRONG_EXECUTOR'; END IF;
  IF NEW.execution_mode = 'bpm_v1' AND version_status IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'BPM_VERSION_NOT_PUBLISHED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bpm_request_executor BEFORE INSERT OR UPDATE OR DELETE ON requests FOR EACH ROW EXECUTE FUNCTION bpm_request_executor_guard();
