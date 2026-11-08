import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_remove_clientresponsible_categories_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Person',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='criado em')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='atualizado em')),
                ('name', models.CharField(blank=True, max_length=150, verbose_name='nome')),
                ('email', models.EmailField(blank=True, max_length=254, verbose_name='e-mail')),
                ('phone', models.CharField(blank=True, max_length=20, verbose_name='telefone')),
                ('is_active', models.BooleanField(default=True, verbose_name='ativo')),
                (
                    'company',
                    models.ForeignKey(
                        blank=True,
                        help_text='Empresa à qual esta pessoa pertence (equipe interna). Deixe em branco para um contato externo (ex: Responsável do Cliente sem vínculo direto com uma empresa do grupo).',
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='people',
                        to='core.company',
                        verbose_name='empresa',
                    ),
                ),
                (
                    'user',
                    models.OneToOneField(
                        blank=True,
                        help_text='Vincule um usuário para dar login a esta pessoa (ex: como Colaborador, para acessar Minhas Tarefas). Para o acesso de portal de um contato do cliente, configure o escopo diretamente no cadastro do Usuário (campo Cliente).',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='person',
                        to=settings.AUTH_USER_MODEL,
                        verbose_name='usuário vinculado',
                    ),
                ),
            ],
            options={
                'verbose_name': 'pessoa',
                'verbose_name_plural': 'pessoas',
                'ordering': ('name',),
            },
        ),
        migrations.AlterModelOptions(
            name='clientresponsible',
            options={'ordering': ('person__name',), 'verbose_name': 'Responsável do Cliente', 'verbose_name_plural': 'Responsáveis do Cliente'},
        ),
        migrations.AlterModelOptions(
            name='collaborator',
            options={'ordering': ('person__name',), 'verbose_name': 'colaborador', 'verbose_name_plural': 'colaboradores'},
        ),
        migrations.AlterModelOptions(
            name='responsible',
            options={'ordering': ('person__name',), 'verbose_name': 'responsável', 'verbose_name_plural': 'responsáveis'},
        ),
        migrations.RemoveConstraint(
            model_name='clientresponsible',
            name='unique_responsible_name_per_client',
        ),
        migrations.RemoveConstraint(
            model_name='collaborator',
            name='unique_collaborator_registration_per_company',
        ),
        migrations.RemoveConstraint(
            model_name='collaborator',
            name='unique_collaborator_yellow_badge_per_company',
        ),
        migrations.AddField(
            model_name='clientresponsible',
            name='person',
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='client_responsible_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
        migrations.AddField(
            model_name='collaborator',
            name='person',
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='collaborator_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
        migrations.AddField(
            model_name='responsible',
            name='person',
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='responsible_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
    ]
