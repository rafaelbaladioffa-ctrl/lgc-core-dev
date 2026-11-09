"""Corrige bancos em que `users_user.axis_user_id` ficou como texto (varchar).

A 0006 declara `UUIDField`, mas um banco que aplicou uma versão anterior dela ficou com a coluna em
`character varying`. No Postgres isso quebra toda consulta por `axis_user_id` com
`operator does not exist: character varying = uuid` (o webhook do Core cai em 500 nos eventos `user.*`).

Só age no Postgres e só quando a coluna não é `uuid`: em banco correto (e no SQLite dos testes) não faz nada.
O estado do Django não muda (o campo já é `UUIDField`), por isso não há `AlterField`.
"""

from django.db import migrations


def axis_user_id_para_uuid(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != "postgresql":
        return
    with conn.cursor() as cur:
        cur.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = 'users_user' AND column_name = 'axis_user_id'"
        )
        row = cur.fetchone()
        if not row or row[0] == "uuid":
            return
        # Índice de texto (`varchar_pattern_ops`) que o Django cria para CharField não serve para uuid.
        cur.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'users_user' "
            "AND indexdef LIKE '%%axis_user_id%%' AND indexdef LIKE '%%pattern_ops%%'"
        )
        for (index_name,) in cur.fetchall():
            cur.execute(f'DROP INDEX IF EXISTS "{index_name}"')
        cur.execute(
            "ALTER TABLE users_user ALTER COLUMN axis_user_id TYPE uuid "
            "USING NULLIF(BTRIM(axis_user_id), '')::uuid"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0006_user_axis_user_id"),
    ]

    operations = [
        migrations.RunPython(axis_user_id_para_uuid, migrations.RunPython.noop),
    ]
