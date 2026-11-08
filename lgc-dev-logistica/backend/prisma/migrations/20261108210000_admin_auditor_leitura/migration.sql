-- O admin do Axis passa a ter também o perfil AUDITOR (leitura de toda a operação, inclusive todas as
-- ordens de atendimento). Só dados: vale para bancos já semeados; num banco novo os perfis ainda não
-- existem aqui e o seed aplica o mesmo mapeamento a partir de DEFAULT_AXIS_ROLE_MAP.
-- Roda uma vez: se depois alguém tirar o AUDITOR do admin pela tela de acessos, isso é respeitado.
INSERT INTO "axis_role_to_logistics_role" ("axis_role", "logistics_role_id")
SELECT 'admin', r."id" FROM "logistics_roles" r WHERE r."code" = 'AUDITOR'
ON CONFLICT DO NOTHING;
