-- User login management (PLANNING.md 4.7): force a password change on next login when the
-- password was set by an admin/RH (creation or reset), since there is no SMTP/invite flow yet.

ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
