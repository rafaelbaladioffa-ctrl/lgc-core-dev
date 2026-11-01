-- `sensitive_data_access_logs.actor_user_id` always holds a valid, currently-authenticated user's
-- id (it's never user-supplied — see SensitiveAccessLogService.record), so adding this FK
-- constraint now is safe against the existing data.
ALTER TABLE "sensitive_data_access_logs" ADD CONSTRAINT "sensitive_data_access_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
