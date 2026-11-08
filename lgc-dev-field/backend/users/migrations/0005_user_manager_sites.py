from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0031_pushsubscription'),
        ('users', '0004_user_must_change_password'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='manager_sites',
            field=models.ManyToManyField(
                blank=True,
                help_text=(
                    'Restringe este usuário interno (gestor) a visualizar/editar apenas os Projetos e dados dos '
                    'Sites marcados. O usuário continua sendo equipe interna (sem vínculo de Cliente) — as '
                    'permissões Django continuam valendo. Deixe em branco para acesso irrestrito a todos os Sites.'
                ),
                related_name='manager_users',
                to='core.site',
                verbose_name='sites do gestor',
            ),
        ),
    ]
