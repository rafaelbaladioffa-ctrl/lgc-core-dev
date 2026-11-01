-- The ticket_form/ticket_category/ticket permissions were replaced by request_category/request
-- ones when the Requisições module was rewritten (REQUISICOES_SPEC.md). prisma/seed.ts no longer
-- lists them, but seed.ts only upserts — it never deletes rows a previous run created, so a
-- database seeded before this change still has them attached to roles. Remove both the
-- role_permissions rows and the permissions themselves.

DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "resource" IN ('ticket_form', 'ticket_category', 'ticket')
);

DELETE FROM "permissions" WHERE "resource" IN ('ticket_form', 'ticket_category', 'ticket');
