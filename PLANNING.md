# Axis — Documento de Planejamento (v0.2)

> Status: aprovado para fase de codificação. Nome definitivo: **Axis**.

## 1. Visão geral

Axis é o sistema core corporativo — ponto único de verdade para usuários, colaboradores, estrutura organizacional, clientes e projetos. É a base de integração para 4 sistemas satélites futuros:

- Field Manager / Projetos (campo)
- Logística / Almoxarifado
- Financeiro
- RH

**Princípio de design:** o Axis nasce desacoplado. Os outros sistemas não terão acesso direto ao banco do Axis — toda integração passa por API REST versionada (`/api/v1/...`) + eventos via outbox/webhook. Isso evita acoplamento forte agora e permite trocar/escalar peças depois sem quebrar os satélites.

**Escopo de tenancy:** unidade única (sem multi-tenancy). Não há isolamento de dados por filial no MVP; se a empresa expandir para múltiplas unidades no futuro, isso será tratado como evolução de arquitetura (provavelmente deploy separado por unidade, não multi-tenant no mesmo banco).

**Volume de referência (dimensionamento):** 50–300 colaboradores/usuários ativos. Isso dimensiona a VPS de produção:

| Recurso | Especificação recomendada |
|---|---|
| vCPU | 4 |
| RAM | 8 GB |
| Disco | 80 GB SSD (NVMe preferível) + backup externo |
| Banda | Padrão do provedor (Hetzner CX-ish / DigitalOcean equivalente) |

Essa especificação acomoda o Axis + os 4 satélites futuros rodando em containers Docker Compose na mesma VPS, com margem para crescer até ~500 usuários antes de precisar de upgrade ou separação de serviços.

### 1.1 Diretrizes globais de desenvolvimento (padrão permanente, todos os módulos)

Válido para todo módulo já implementado e todo módulo futuro do Axis — não precisa ser repetido a cada feature nova; qualquer especificação deste documento é um complemento a isto, nunca uma substituição.

**Padrões brasileiros obrigatórios:** idioma pt-BR; moeda BRL com símbolo R$ e formatação `R$ 1.234,56` (vírgula decimal, ponto de milhar) em telas, tabelas, dashboards, relatórios e exports — valor numérico sempre separado da apresentação, nunca float impreciso (usar `Decimal`/numeric no banco e na camada de cálculo), nunca cálculo dependente do símbolo; datas `DD/MM/AAAA`, data+hora `DD/MM/AAAA HH:mm` (24h), fuso `America/Sao_Paulo`; máscaras de CPF/CNPJ/CEP/telefone nos padrões brasileiros; percentuais com vírgula (`15,50%`); não permitir valor negativo onde a regra de negócio não autorizar.

**Todo formulário** (sem precisar pedir explicitamente): campos obrigatórios identificados visualmente; máscaras de entrada; validação de tipo/formato com mensagem de erro em pt-BR; indicação de campo inválido; valores iniciais sensatos; busca em listas/selects extensos; calendário para datas; formatação monetária ao digitar; upload de anexo com restrição de tipo/tamanho; botões salvar/cancelar/voltar; aviso ao sair com alterações não salvas; proteção contra envio duplicado (double-submit); feedback de sucesso/erro; responsivo; navegação por teclado básica.

**Toda tabela/listagem** (quando pertinente): busca, filtros, ordenação, paginação, contagem de registros, estado vazio, estado de carregamento, ações por linha, export conforme permissão, formatação correta de valor/data/status.

**Todo registro operacional**, quando aplicável ao domínio: identificador único + código amigável, setor/unidade responsável, usuário solicitante, criado em/por, status, última alteração por/em, histórico relevante, permissões de acesso. Reaproveitar cadastros existentes (clientes, setores, colaboradores, projetos, centros de custo) — nunca duplicar.

**Segurança (sempre, nos dois lados):** autenticação+autorização; validação de permissão no backend (nunca só no frontend — ver precedente do `must_change_password`, seção 4.7); validação de todo dado no servidor; transações quando houver alterações relacionadas; nunca expor credencial/dado sensível além do necessário; sem exclusão definitiva de registro operacional sem regra explícita que autorize; respeitar retenção/privacidade já definidas (seção 6).

**Consistência visual:** reusar componentes/tokens/ícones/tipografia do design system Axis já definido (branding/) — nunca criar um componente visualmente diferente quando já existe um equivalente.

**Regra de autonomia:** ao implementar qualquer funcionalidade, antecipar esses padrões sem precisar que sejam repetidos na spec. Ao identificar uma melhoria claramente dentro dessas diretrizes (não uma decisão de negócio nova), pode implementar direto. Decisão de negócio não coberta aqui (regra crítica não definida) deve ser levantada como recomendação antes de presumida. Preservar arquitetura/dados/funcionalidades existentes — sem refatoração extensa ou mudança destrutiva sem aprovação explícita.

## 2. Stack técnica

| Camada | Escolha |
|---|---|
| Backend | Node.js + NestJS (TypeScript) |
| Frontend | React (Vite) |
| Banco de dados | PostgreSQL 16 |
| ORM | Prisma |
| Auth | JWT + refresh token, RBAC |
| Fila/eventos | Outbox pattern (tabela) + webhooks HTTP — ver seção 3 |
| Infra | VPS (Hetzner/DigitalOcean), Docker Compose no MVP |
| Integração futura | API REST central versionada (`/api/v1/...`) + webhooks de eventos |

## 3. Arquitetura de integração com os sistemas satélites

**Decisão: Outbox + webhook (não RabbitMQ).** Para o volume esperado (50–300 usuários, 4 satélites, baixo throughput de eventos de cadastro) uma fila dedicada é complexidade desnecessária. Outbox+webhook é mais simples de operar numa única VPS, sem serviço adicional para manter. Se o volume de eventos crescer muito (ordens de magnitude maiores) ou surgir necessidade de processamento assíncrono pesado, migrar para RabbitMQ é um item de v2 — o desenho abaixo já isola essa decisão (os satélites consomem eventos via webhook, não acessam a tabela outbox diretamente, então troubleshooting da fila não exige mudança de contrato).

### 3.1 Fluxo de eventos (outbox pattern)

1. Uma transação que altera estado relevante (ex: criar colaborador) grava a mudança **e** uma linha na tabela `integration_outbox` **na mesma transação** (garante atomicidade — nunca perde evento por falha após commit parcial).
2. Um worker (`OutboxDispatcherService`, rodando a cada N segundos via `@Cron` do NestJS) lê eventos `status = PENDING`, ordenados por `created_at`, e faz `POST` para o webhook registrado de cada sistema satélite que assinou aquele tipo de evento.
3. Em caso de sucesso (HTTP 2xx), marca `status = DELIVERED`. Em falha, incrementa `attempts`, grava `last_error`, e aplica retry com backoff exponencial (ex: 1min, 5min, 30min, 2h, depois marca `FAILED` e gera alerta/log para intervenção manual).
4. Cada satélite expõe um endpoint `POST /webhooks/axis` que recebe o payload, valida a assinatura (HMAC com secret por satélite) e processa de forma **idempotente** (usa `event_id` para deduplicar — se já processou, responde 200 sem reprocessar).

### 3.2 Autenticação entre sistemas

- Cada sistema satélite recebe, no cadastro em Axis, uma **API key** (service account) usada para chamadas síncronas (satélite → Axis, ex: buscar dados de um colaborador).
- Webhooks (Axis → satélite) são assinados com **HMAC-SHA256** usando um secret compartilhado por satélite (header `X-Axis-Signature`), para o satélite verificar autenticidade do payload.
- Nunca se usa o login/token do usuário final para comunicação service-to-service.

### 3.3 Eventos publicados (v1)

| Evento | Disparado quando | Payload principal |
|---|---|---|
| `user.created` | Usuário criado no Axis | `user_id`, `email`, `roles`, `collaborator_id` |
| `user.updated` | Dados de login/roles alterados | `user_id`, campos alterados |
| `user.disabled` | Usuário desativado/desligado | `user_id`, `disabled_at`, `reason` |
| `collaborator.created` | Colaborador cadastrado | `collaborator_id`, `name`, `sector_id`, `cost_center_id`, provisioning flags (quais satélites devem criar o registro) |
| `collaborator.updated` | Dados cadastrais alterados | `collaborator_id`, campos alterados |
| `collaborator.offboarded` | Colaborador desligado | `collaborator_id`, `offboarded_at` |
| `client.created` / `client.updated` | Cliente cadastrado/alterado | `client_id`, `code`, campos |
| `project.created` / `project.status_changed` | Projeto criado ou status mudou | `project_id`, `code`, `status`, `client_id` |
| `ticket.created` / `ticket.status_changed` | Chamado criado/mudou de status | `ticket_id`, `sector_id`, `status` |

Cada satélite assina (`integration_subscription`) apenas os eventos que lhe interessam.

## 4. Módulos do MVP

### 4.1 Autenticação e Autorização
- Login (email/senha, JWT + refresh)
- RBAC: Roles (ex: Admin, Gestor, RH, Técnico, Colaborador) e Permissions granulares por módulo/ação
- Log de auditoria de ações sensíveis (quem acessou/alterou dado de colaborador)

### 4.2 Colaboradores
Campos base: Nome completo, RG, CPF, CTPS, PIS, Cargo, Setor, ASO (data/validade), Yellow Badge, Email, Hierarquia (superior direto), Organograma (derivado).

Campos adicionais para **Técnicos**: NR-10, NR-35, NR-12, NR-18 (cada um com data de emissão e validade — para alertar vencimento).

Dados sensíveis (CPF, RG, CTPS, PIS, ASO): **criptografados em repouso** (campo a campo, via `pgcrypto` ou criptografia na camada da aplicação) + log de acesso (quem visualizou o dado sensível, quando).

**Retenção pós-desligamento: dados sensíveis NÃO são excluídos automaticamente** (decisão do usuário — manter indefinidamente, sem rotina de expurgo). O registro do colaborador é marcado como `offboarded` (soft state), mantendo histórico completo para fins de referência futura (ex: histórico de projetos, chamados, auditoria). Caso política de retenção mude depois, basta implementar uma rotina de anonimização sem alterar o modelo (o campo `offboarded_at` já serve de gatilho).

### 4.3 Estrutura organizacional
- Setores (código, nome, responsável)
- Centro de Custos (código, nome, setor vinculado)
- Hierarquia: cada colaborador aponta para 1 superior direto (árvore) → organograma montado automaticamente

### 4.4 Clientes
- Cadastro com código único por cliente (ex: 100, 200, 300...)
- Dados cadastrais padrão (razão social, CNPJ, contatos, endereço)

### 4.5 Projetos
- Código gerado automaticamente: `PROP-{cliente}.{proposta}-{mes}{ano}`, onde `{proposta}` é sequência **global** (zero-padded)
- Exemplo: `PROP-100.001-1026`
- Vínculo: cliente, centro de custo, responsável, status (proposta/aprovado/em execução/encerrado)

### 4.6 Sistema de Requisições — SUPERSEDIDO, ver `REQUISICOES_SPEC.md`

O escopo descrito em 4.6/4.6.1/4.6.2/4.6.3 abaixo foi a primeira versão (rename Chamados→Requisições + categorias por setor + aprovação hierárquica simples + formulário por categoria) e **já estava implementado**, mas o usuário pediu para refazer o módulo do zero com um escopo muito mais amplo. A especificação vigente e definitiva é o arquivo `REQUISICOES_SPEC.md` na raiz do projeto — módulo de **Requisições Intersetoriais**, cobrindo os 17 setores/subsetores da LGC, catálogo versionado de categorias, motor de workflow configurável (não hardcoded), matriz de alçadas financeiras parametrizável, SLA avançado com calendário/pausas/escalonamento, confidencialidade por registro, delegação de aprovação, anexos seguros versionados e auditoria completa.

**Rollout em fases (ver seção 23 de `REQUISICOES_SPEC.md`):**
- **Fase 1 — Fundação** (a implementar agora): entidades, catálogo versionado, campos dinâmicos, estados, filas, permissões, auditoria, telas de portal/nova requisição/minhas requisições/detalhe/fila, notificações básicas, SLA básico. Categorias prioritárias: TI, Financeiro, Suprimentos, RH/DP, Administração (5 dos 17 setores).
- **Fase 2 — Governança** (depois): workflow visual/configurável, alçadas, delegações, conflitos de interesse, calendários, anexos seguros, subtarefas, dashboards. Entram Jurídico, Compliance, HSE/SST, Qualidade, Operações.
- **Fase 3 — Integração e escala** (depois): integrações transacionais, Comercial, Clientes, Projetos, Frota, Patrimônio, Diretoria, webhooks, relatórios avançados.

As subseções 4.6/4.6.1/4.6.2/4.6.3 abaixo ficam só como registro histórico da v1 (já removida do código a pedido do usuário) — não usar como referência para a reimplementação.

#### 4.6 (histórico) Sistema de Requisições (antigo "Chamados", estilo GLPI/Lecom)
Nível: completo, com formulários customizáveis por setor **e SLA/escalonamento incluído no MVP** (decisão do usuário). Renomeado de "Chamados" para **"Requisições"** — vale em todo o sistema (model, rotas, telas, menu).

- Setores definem seus próprios formulários de abertura de requisição (campos customizados: texto, select, data, anexo)
- Categorias e subcategorias de requisição por setor (ver 4.6.1), cada uma com **SLA configurável** (prazo de primeira resposta e prazo de resolução)
- Fluxo: Aberto → **Em aprovação** → Em andamento → Pendente → Resolvido → Fechado (ou **Rejeitado**, que retorna ao solicitante — ver 4.6.2)
- Atribuição automática/manual para responsável do setor
- **Escalonamento automático:** se o SLA de uma etapa for ultrapassado, a requisição é automaticamente escalada (ex: notifica o superior do responsável, ou reatribui para um nível acima), registrado como evento `ticket.escalated`
- Comentários e histórico (timeline) por requisição
- Anexos (arquivos)

#### 4.6.1 Categorias de requisição por setor (proposta aprovada)

| Setor | Categorias |
|---|---|
| **Operações / Campo** | Liberação de técnico para projeto; Solicitação de equipamento/ferramenta; Reporte de ocorrência em campo; Solicitação de deslocamento/viagem 💰 |
| **Engenharia / Projetos** | Abertura de novo projeto; Alteração de escopo/proposta 💰; Solicitação de revisão técnica/documento |
| **SSMA** | Agendamento de ASO; Renovação de certificação NR 💰; Comunicação de incidente/quase-acidente (CAT); Solicitação de EPI |
| **Suprimentos / Almoxarifado** | Requisição de material/insumo; Solicitação de compra 💰; Devolução/transferência de material |
| **TI** | Criação de acesso/usuário; Suporte técnico; Solicitação de equipamento de TI 💰 |
| **RH** | Admissão/desligamento; Alteração cadastral; Solicitação de férias/afastamento |
| **Financeiro** | Solicitação de pagamento/reembolso 💰; Aprovação de despesa de projeto 💰; Consulta/ajuste de centro de custo |
| **Comercial** | Novo cliente; Nova proposta comercial; Solicitação de informações para cliente |

💰 = categoria **com custo** (ver fluxo de aprovação abaixo). As demais são **sem custo**. Essa flag é configurada por categoria em `ticket_categories.has_cost`, não calculada dinamicamente — decisão tomada na criação da categoria, revisável pelo admin.

#### 4.6.2 Fluxo de aprovadores

Toda requisição passa por aprovação antes de entrar em execução. O caminho depende de a categoria ter custo (`has_cost`):

- **Sem custo:** Solicitante → **gestor direto** (1 único passo, `supervisor_id` do solicitante). Aprovado = segue direto pro responsável do setor executar.
- **Com custo:** Solicitante → **Supervisor → Coordenador → Gerente → Diretor**, nessa ordem, subindo a cadeia de `supervisor_id` do solicitante. Cada nível precisa aprovar para passar ao próximo.
  - **Nível ausente na cadeia:** se não existir ninguém com aquele `management_level` entre o solicitante e o próximo nível existente, esse passo é **pulado automaticamente** (não bloqueia o fluxo).
  - **Solicitante já está em um nível alto:** níveis iguais ou abaixo do próprio `management_level` do solicitante são pulados (ex: um Coordenador abrindo a requisição não precisa de aprovação de Supervisor/Coordenador, só de Gerente e Diretor).
- **Rejeição em qualquer nível:** a requisição volta ao `status = rejeitado`, com o motivo registrado; o solicitante pode editar e reenviar, o que **reinicia o ciclo de aprovação do zero** (um novo conjunto de `ticket_approvals` é criado).

Isso exige um novo campo em `collaborators` — ver 5.3 atualizado — e duas tabelas novas, `ticket_approval_steps` (modelo) e `ticket_approvals` (execução), detalhadas em 5.17/5.18.

#### 4.6.3 Formulário customizado por categoria (campos dinâmicos)

Decisão do usuário: cada **categoria** (não cada setor) tem seu próprio formulário de abertura, com campos específicos para aquele tipo de requisição — ex: reembolso de viagem precisa de tipo de reembolso, km percorrido, destino A/destino B, anexo de comprovante; abertura de acesso de TI precisa de sistema/qual acesso. `ticket_forms.sector_id` deixa de ser o vínculo usado para resolver o formulário de uma requisição — passa a ser `ticket_categories.form_id` (1 formulário por categoria; `ticket_forms.sector_id` permanece só para agrupar/organizar no admin). O campo "solicitante" **nunca aparece no formulário** — é sempre o usuário logado (`tickets.requester_id` preenchido automaticamente pelo backend a partir do JWT, nunca aceito no payload de criação).

Tipos de campo suportados no `schema` (jsonb) de `ticket_forms`: `text`, `textarea`, `number`, `date`, `select` (com `options: string[]`), `checkbox`, `attachment` (múltiplos arquivos). Cada campo: `{ key, label, type, required, options? }`.

Formulário por categoria (campos customizados, além dos padrões título/descrição que todo ticket já tem):

| Setor | Categoria | Campos customizados |
|---|---|---|
| Operações/Campo | Liberação de técnico para projeto | projeto (select, projetos ativos), técnico (select, colaboradores), data_inicio (date), data_fim (date) |
| Operações/Campo | Solicitação de equipamento/ferramenta | equipamento (text), quantidade (number), motivo (textarea) |
| Operações/Campo | Reporte de ocorrência em campo | local (text), data_ocorrencia (date), descricao (textarea, required), anexo_fotos (attachment) |
| Operações/Campo | Solicitação de deslocamento/viagem 💰 | tipo_reembolso (select: Combustível/Hospedagem/Alimentação/Pedágio/Outro), km_percorrido (number), destino_a (text), destino_b (text), data_viagem (date), valor_estimado (number), anexo_comprovantes (attachment, required) |
| Engenharia/Projetos | Abertura de novo projeto | cliente (select, clientes), escopo_resumido (textarea, required), centro_custo (select, centros de custo) |
| Engenharia/Projetos | Alteração de escopo/proposta 💰 | projeto (select, projetos), alteracao_descrita (textarea, required), valor_adicional (number), anexo_documento (attachment) |
| Engenharia/Projetos | Solicitação de revisão técnica/documento | documento (text), tipo_revisao (select: Técnica/Comercial/Jurídica), anexo_documento (attachment, required) |
| SSMA | Agendamento de ASO | tipo_aso (select: Admissional/Periódico/Demissional/Retorno ao trabalho/Mudança de função), data_preferencial (date) |
| SSMA | Renovação de certificação NR 💰 | norma_nr (select: NR-10/NR-12/NR-18/NR-33/NR-35/Outra), validade_atual (date), custo_estimado (number) |
| SSMA | Comunicação de incidente/quase-acidente (CAT) | local (text, required), data_hora (date, required), gravidade (select: Leve/Moderada/Grave), descricao (textarea, required), anexo_evidencias (attachment) |
| SSMA | Solicitação de EPI | item (text, required), quantidade (number), motivo (select: Primeira entrega/Desgaste/Perda/Troca de tamanho) |
| Suprimentos/Almoxarifado | Requisição de material/insumo | item (text, required), quantidade (number, required), centro_custo (select, centros de custo), urgencia (select: Normal/Urgente) |
| Suprimentos/Almoxarifado | Solicitação de compra 💰 | item_servico (text, required), quantidade (number), valor_estimado (number, required), fornecedor_sugerido (text), justificativa (textarea, required) |
| Suprimentos/Almoxarifado | Devolução/transferência de material | item (text, required), quantidade (number), origem (text), destino (text), motivo (textarea) |
| TI | Criação de acesso/usuário | sistema (select: Axis/E-mail/VPN/Outro), nivel_acesso (text), colaborador_beneficiario (select, colaboradores) |
| TI | Suporte técnico | equipamento_sistema (text, required), descricao_problema (textarea, required), urgencia (select: Normal/Urgente/Crítica) |
| TI | Solicitação de equipamento de TI 💰 | tipo_equipamento (select: Notebook/Monitor/Periférico/Celular/Outro), justificativa (textarea, required), valor_estimado (number) |
| RH | Admissão/desligamento | tipo (select: Admissão/Desligamento), colaborador (select, colaboradores, obrigatório só se desligamento), cargo (select, cargos, obrigatório só se admissão), data_efetiva (date, required) |
| RH | Alteração cadastral | colaborador (select, colaboradores, required), campo_a_alterar (select: Endereço/Dados bancários/Dados pessoais/Cargo/Setor), descricao_alteracao (textarea, required) |
| RH | Solicitação de férias/afastamento | tipo (select: Férias/Licença/Afastamento médico), data_inicio (date, required), data_fim (date, required), anexo_atestado (attachment) |
| Financeiro | Solicitação de pagamento/reembolso 💰 | tipo_despesa (select: Viagem/Combustível/Material/Outro), valor (number, required), favorecido (text), anexo_comprovante (attachment, required) |
| Financeiro | Aprovação de despesa de projeto 💰 | projeto (select, projetos, required), descricao_despesa (textarea, required), valor (number, required), anexo_nota_fiscal (attachment) |
| Financeiro | Consulta/ajuste de centro de custo | centro_custo (select, centros de custo), tipo_ajuste (select: Correção de lançamento/Reclassificação/Dúvida), descricao (textarea, required) |
| Comercial | Novo cliente | nome_cliente (text, required), cnpj_cpf (text), segmento (text), origem_contato (text) |
| Comercial | Nova proposta comercial | cliente (select, clientes, required), resumo_proposta (textarea, required), valor_estimado (number) |
| Comercial | Solicitação de informações para cliente | cliente (select, clientes, required), assunto (text, required), detalhes (textarea) |

Campos do tipo `select` que referenciam outro cadastro (projeto, colaborador, cliente, centro de custo, cargo) são resolvidos no frontend via autocomplete chamando a API daquele módulo — o `schema` guarda só `optionsSource` (ex: `"projects"`, `"collaborators"`, `"clients"`, `"cost_centers"`, `"job_titles"`) em vez de uma lista estática de `options`.

### 4.7 Gestão de usuários (login)

Hoje não existe fluxo para criar um `User` (login) — só o admin seedado manualmente. `users` e `collaborators` são tabelas separadas de propósito (pessoa física vs. credencial de acesso); um `Collaborator` pode existir sem nunca ganhar login.

- **Tela "Usuários"** (novo módulo no menu, visível só a quem tem permissão de admin/RH): lista (busca, filtro por status/role), criar, editar, ativar/desativar.
- **Criar usuário:** vincula a um `Collaborator` já existente (busca por nome/matrícula) — o `email` do `User` vem pré-preenchido a partir do `corporate_email` do colaborador, mas é editável, pois `users.email` é campo independente. Atribuição de uma ou mais roles no mesmo formulário (`user_roles`).
- **Senha inicial — decisão (sem dependência de e-mail, pois o projeto não tem SMTP configurado):** o admin/RH define uma senha temporária no momento da criação (ou o sistema gera uma automaticamente e exibe uma única vez na tela, para copiar/entregar ao colaborador). Novo campo `users.must_change_password` (boolean, default `true` ao criar via este fluxo) — login com essa flag ativa força a tela de troca de senha antes de liberar o resto do sistema. Reset de senha por um admin (ex: colaborador esqueceu) reusa o mesmo mecanismo: define nova senha temporária + `must_change_password = true`.
- Isso fica registrado como ponto de evolução: se no futuro for configurado um provedor de e-mail, o fluxo de convite por link passa a ser uma opção adicional (não obrigatório agora).
- Ativar/desativar usuário = `users.status` (`active`/`disabled`); desativado não consegue logar, mas o `Collaborator` associado continua intacto (não é o mesmo fluxo de desligamento de colaborador, que é independente).
- Auditoria: criação de usuário, troca de role e ativação/desativação geram `audit_logs`.

Isso exige um novo campo em `users` — `must_change_password boolean default false` — ver 5.1 atualizado.

## 5. Modelo de dados — schema completo

Convenções: `id` sempre UUID v4. Timestamps `created_at`/`updated_at` em todas as tabelas (omitidos abaixo por brevidade, exceto quando relevantes ao negócio). Campos sensíveis marcados com 🔒 (criptografados em repouso).

### 5.1 `users`
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| email | varchar(255) unique | |
| password_hash | varchar(255) | bcrypt/argon2 |
| status | enum(`active`,`disabled`) | |
| last_login_at | timestamp | nullable |
| collaborator_id | uuid (FK → collaborators.id) | nullable (nem todo user é colaborador, ex: conta de serviço) |
| must_change_password | boolean | default `false`; `true` quando a senha foi definida pelo admin/RH na criação ou em reset — força a troca no próximo login (ver 4.7) |

### 5.2 `roles` / `permissions` / `role_permissions` / `user_roles`
| Tabela | Campos |
|---|---|
| roles | id, name (ex: admin, gestor, rh, tecnico, colaborador), description |
| permissions | id, resource (ex: `collaborator`), action (ex: `read_sensitive`), description |
| role_permissions | role_id (FK), permission_id (FK) — PK composta |
| user_roles | user_id (FK), role_id (FK) — PK composta |

### 5.3 `collaborators`
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| matricula | varchar(4+) unique | código interno sequencial, gerado atomicamente (`0000`, `0001`, `0002`...) a partir da sequence `collaborator_matricula_seq` (mesmo padrão de `client_code_seq`/`project_proposal_seq`, seção 5.9) — somente leitura pela API, nunca aceito no `create`/`update` |
| full_name | varchar(255) | |
| rg | varchar(20) 🔒 | |
| cpf | varchar(14) 🔒 unique | |
| ctps | varchar(30) 🔒 | nullable |
| pis | varchar(20) 🔒 | nullable |
| personal_email | varchar(255) | nullable — informativo apenas |
| corporate_email | varchar(255) unique | substitui o antigo `email`; nenhum dos dois dirige o login — isso é `users.email`, registro independente ligado só opcionalmente via `users.collaborator_id` |
| job_title_id | uuid (FK → job_titles.id) | substitui o antigo `job_title` (texto livre); cargo agora é um cadastro próprio (seção 5.3.1) |
| sector_id | uuid (FK → sectors.id) | |
| supervisor_id | uuid (FK → collaborators.id) | nullable, auto-referência (hierarquia) |
| aso_date | date | data do ASO |
| aso_validity | date | validade do ASO |
| yellow_badge | varchar(60) | nullable — identificador/login do crachá amarelo (não é mais um flag booleano sim/não) |
| status | enum(`ativo`,`afastado`,`ferias`,`desligado`) | ampliado a partir do antigo `active`/`offboarded`; migração mapeia 1:1 (`active`→`ativo`, `offboarded`→`desligado`) |
| offboarded_at | timestamp | nullable, preenchido quando `status` vira `desligado` (via `POST /collaborators/:id/offboard`) |
| management_level | enum(`colaborador`,`supervisor`,`coordenador`,`gerente`,`diretor`) | default `colaborador`; usado para resolver a cadeia de aprovação de requisições com custo (ver 4.6.2) — não precisa bater com `job_title_id`, é só o nível pra fins de aprovação |
| phone | varchar(30) | nullable, telefone/celular |
| emergency_contact_name | varchar(120) | nullable |
| emergency_contact_phone | varchar(30) | nullable |
| birth_date | date | nullable |
| marital_status | enum(`solteiro`,`casado`,`divorciado`,`viuvo`,`uniao_estavel`) | nullable |
| gender | enum(`masculino`,`feminino`,`outro`,`prefiro_nao_informar`) | nullable — era texto livre, virou dropdown fixo |
| cep | varchar(9) | nullable; o frontend consulta a API pública ViaCEP (https://viacep.com.br/ws/{cep}/json/, sem chave) ao digitar e preenche logradouro/bairro/cidade/UF automaticamente — todos os campos de endereço continuam editáveis manualmente depois |
| address_street | varchar(255) | nullable, logradouro |
| address_number | varchar(20) | nullable |
| address_complement | varchar(120) | nullable |
| address_district | varchar(120) | nullable, bairro |
| address_city | varchar(120) | nullable |
| address_state | varchar(2) | nullable, UF |
| admission_date | date | nullable, data de admissão |
| contract_type | enum(`CLT`,`PJ`,`estagio`,`terceirizado`) | nullable |
| work_schedule_id | uuid (FK → work_schedules.id) | nullable; substitui o antigo `work_schedule` (texto livre) — jornada agora é um cadastro próprio (seção 5.3.2) |
| cost_center_id | uuid (FK → cost_centers.id) | nullable — centro de custo onde o colaborador está alocado; dropdown lista todos os centros de custo, sem filtrar pelo setor escolhido; sem histórico de mudanças |
| photo_filename | varchar(255) | nullable — metadado apenas (mesmo padrão de `ticket_attachments`: sem backend de upload binário ainda) |
| photo_storage_path | varchar(500) | nullable |
| uniform_size | varchar(10) | nullable, tamanho de uniforme/EPP |
| cnh_category | varchar(2) | nullable, uma de A/B/C/D/E/AB/AC/AD/AE |
| cnh_number | varchar(11) | nullable, número da CNH |
| cnh_expires_at | date | nullable |

Deliberadamente fora de escopo (pedido explícito do usuário): tipo sanguíneo e dados bancários.

No frontend, os campos telefone/RG/CPF/CTPS/PIS/CEP/CNH (número) recebem máscara de digitação
automática (implementação própria leve, sem dependência externa) — o usuário digita só números e a
pontuação é inserida conforme digita.

**Convenção de formulário (todo o sistema)**: todo cadastro/edição abre como página própria em
rota dedicada (`/<módulo>/novo`, `/<módulo>/:id/editar`), nunca modal/card sobreposto —
reaproveitando o componente `FormPage`/`FormSection` do frontend
(`src/components/layout/FormPage.tsx`). Aplicado a Colaboradores, Setores, Centros de Custo,
Cargos, Jornadas de Trabalho, Clientes, Projetos, Chamados e Integrações (satélites); qualquer
módulo novo deve seguir o mesmo padrão.

### 5.3.1 `job_titles`
Cadastro próprio de cargos, substituindo o antigo campo de texto livre `collaborators.job_title`.
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| name | varchar(120) unique | |
| is_technician | boolean | default false — quando true, o formulário de colaborador com esse cargo selecionado exibe a seção de certificações NR (seção 5.4); substitui o antigo `collaborators.is_technician` |

### 5.3.2 `work_schedules`
Cadastro próprio de jornadas de trabalho, substituindo o antigo campo de texto livre
`collaborators.work_schedule`.
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| name | varchar(80) | ex: "Comercial", "Escala 12x36" |
| start_time | varchar(5) | `HH:mm`, texto (sem necessidade de tipo TIME nativo aqui) |
| end_time | varchar(5) | `HH:mm` |
| break_minutes | integer | nullable |
| days_of_week | text[] | abreviações (`seg`,`ter`,`qua`,`qui`,`sex`,`sab`,`dom`) |

### 5.4 `technician_certifications`
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| collaborator_id | uuid (FK → collaborators.id) | |
| type | enum(`NR10`,`NR35`,`NR12`,`NR18`) | |
| issued_at | date | |
| expires_at | date | usado para alertas de vencimento |

### 5.5 `sectors`
Hierárquico (pai/filho opcional), com código gerado automaticamente — não é mais um campo de
texto livre aceito do cliente.
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid (PK) | |
| code | varchar(40) unique | gerado pelo servidor, nunca aceito no `create`/`update` (ver abaixo) |
| name | varchar(120) | |
| parent_sector_id | uuid (FK → sectors.id), nullable | auto-referência; vazio = setor raiz |
| responsible_collaborator_id | uuid (FK → collaborators.id), nullable | |

**Geração de código hierárquico** (mesma lógica em `cost_centers`, seção 5.6):
- Setor raiz (`parent_sector_id` vazio): código sequencial múltiplo de 100 (`100`, `200`, `300`,
  ...), via a sequence `sector_root_code_seq` do Postgres — atômica, mesmo padrão de
  `client_code_seq`/`project_proposal_seq` (seção 5.9).
- Subsetor: `<código do pai>.<n>`, `n` 1-based e escopado àquele pai (ex: pai `100` → primeiro
  filho `100.1`, segundo filho `100.2`); recursivo para qualquer profundidade (um filho de
  `100.1` vira `100.1.1`). Uma sequence do Postgres é global e pré-declarada, então não dá pra
  reiniciar em 1 por pai sob demanda — em vez disso, a criação trava a linha do pai
  (`SELECT ... FOR UPDATE`) dentro da mesma transação do insert, serializando criações
  concorrentes de irmãos sob o mesmo pai e evitando colisão de `n`.
- Reparenting (trocar o pai de um setor já existente) não é suportado nesta iteração — exigiria
  recalcular o código de todo o subconjunto de descendentes; criar um novo setor sob o pai
  desejado em vez disso.
- Códigos já existentes antes desta mudança (texto livre, ex. `ADM`) não são alterados
  retroativamente; o esquema novo só vale para registros criados a partir daqui.

No frontend, a tela de Setores mostra a estrutura em árvore (indentada), reaproveitando o mesmo
padrão de componente usado no organograma de Colaboradores. O formulário de criação tem um campo
"Setor pai" (dropdown, opcional) e não aceita mais o código manualmente.

### 5.6 `cost_centers`
Mesmo esquema hierárquico de `sectors` (seção 5.5): `parent_cost_center_id` auto-referência,
código raiz sequencial (`cost_center_root_code_seq`) e subcódigo `<pai>.<n>` gerado com o mesmo
mecanismo de trava de linha + transação.
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| code | varchar(40) unique — gerado pelo servidor |
| name | varchar(120) |
| sector_id | uuid (FK → sectors.id) |
| parent_cost_center_id | uuid (FK → cost_centers.id), nullable |

### 5.7 `clients`
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| code | integer unique | gerado sequencialmente (100, 200, 300...) |
| legal_name | varchar(255) | razão social |
| cnpj | varchar(18) unique | nullable (pode ser pessoa física em casos raros — ajustar se necessário) |
| contacts | jsonb | lista de contatos (nome, telefone, email) |
| address | jsonb | |

### 5.8 `projects`
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| code | varchar(30) unique | ex: `PROP-100.001-1026` |
| client_id | uuid (FK → clients.id) |
| cost_center_id | uuid (FK → cost_centers.id) |
| responsible_collaborator_id | uuid (FK → collaborators.id) |
| status | enum(`proposta`,`aprovado`,`em_execucao`,`encerrado`) |
| proposal_sequence | integer | número sequencial global usado na geração do código (armazenado para auditoria/consulta, não recalculado) |

### 5.9 `proposal_sequence_counter`
Tabela auxiliar de controle para gerar o número sequencial global de forma atômica (evita race condition em criação concorrente de projetos).
| Campo | Tipo |
|---|---|
| id | smallint (PK, sempre = 1) |
| last_value | integer |

(Alternativa: usar uma `SEQUENCE` nativa do PostgreSQL em vez de tabela de controle — recomendado na implementação por ser mais simples e atômica nativamente.)

### 5.10 `ticket_forms` (formulários customizados por setor)
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| sector_id | uuid (FK → sectors.id) |
| name | varchar(120) |
| schema | jsonb | definição dos campos customizados (tipo, label, obrigatoriedade, opções) |

### 5.11 `ticket_categories`
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| sector_id | uuid (FK → sectors.id) |
| name | varchar(120) |
| parent_category_id | uuid (FK → ticket_categories.id) | nullable, para subcategorias |
| sla_first_response_minutes | integer | prazo de primeira resposta |
| sla_resolution_minutes | integer | prazo de resolução |
| has_cost | boolean | default false; define se a requisição dessa categoria segue o fluxo de aprovação multi-nível (4.6.2) ou só o gestor direto |
| form_id | uuid (FK → ticket_forms.id) | nullable; formulário customizado específico desta categoria (ver 4.6.3) |

### 5.12 `tickets` (exibido como "Requisições" na UI)
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| number | varchar(20) unique | identificador legível (ex: `REQ-000123`, prefixo trocado de `TCK` para `REQ`) |
| sector_id | uuid (FK → sectors.id) |
| category_id | uuid (FK → ticket_categories.id) |
| form_id | uuid (FK → ticket_forms.id) | nullable |
| form_data | jsonb | respostas do formulário customizado |
| requester_id | uuid (FK → collaborators.id) |
| assignee_id | uuid (FK → collaborators.id) | nullable |
| status | enum(`aberto`,`em_aprovacao`,`rejeitado`,`em_andamento`,`pendente`,`resolvido`,`fechado`) | `em_aprovacao` enquanto houver passo pendente em `ticket_approvals`; `rejeitado` se qualquer aprovador recusar (volta ao solicitante) |
| sla_due_first_response_at | timestamp | calculado no momento em que sai de `em_aprovacao` (SLA não corre durante a aprovação) |
| sla_due_resolution_at | timestamp | idem |
| escalated_at | timestamp | nullable |
| escalation_level | integer | default 0 |
| closed_at | timestamp | nullable |

### 5.13 `ticket_comments` / `ticket_attachments`
| Tabela | Campos |
|---|---|
| ticket_comments | id, ticket_id (FK), author_id (FK → collaborators), body (text), created_at |
| ticket_attachments | id, ticket_id (FK), filename, storage_path, uploaded_by (FK), created_at |

### 5.13.1 `ticket_approval_steps` (modelo, por categoria)
Define, por categoria de requisição, a sequência de níveis exigidos — só é relevante quando `ticket_categories.has_cost = true` (sem custo usa sempre o `supervisor_id` direto, sem registro aqui).

| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| category_id | uuid (FK → ticket_categories.id) |
| step_order | integer | 1=Supervisor, 2=Coordenador, 3=Gerente, 4=Diretor |
| required_level | enum(`supervisor`,`coordenador`,`gerente`,`diretor`) | |

Seed padrão: toda categoria `has_cost = true` recebe as 4 linhas (1-4) automaticamente na criação; o admin pode remover um nível manualmente se aquela categoria nunca precisar dele.

### 5.13.2 `ticket_approvals` (execução, por requisição)
Instanciada quando uma requisição de categoria `has_cost = true` é criada: o backend resolve a cadeia de `supervisor_id` do `requester_id`, casa cada `management_level` encontrado com os `required_level` de `ticket_approval_steps` (pulando níveis ausentes na cadeia ou iguais/abaixo do nível do próprio solicitante), e grava uma linha por passo realmente necessário. Requisição `has_cost = false` não gera linhas aqui — aprova direto com o `supervisor_id` do solicitante.

| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| ticket_id | uuid (FK → tickets.id) |
| step_order | integer | ordem de execução (já resolvida, sem gaps) |
| required_level | enum(`supervisor`,`coordenador`,`gerente`,`diretor`) | |
| approver_id | uuid (FK → collaborators.id) | colaborador resolvido na cadeia para esse nível |
| status | enum(`pendente`,`aprovado`,`rejeitado`) | default `pendente` |
| decided_at | timestamp | nullable |
| comment | text | nullable — obrigatório quando `status = rejeitado` |

Regra de avanço: só o passo com o menor `step_order` em `pendente` fica ativo (o aprovador daquele passo recebe a notificação); aprovar ativa o próximo `step_order`; aprovar o último marca `tickets.status = aberto` (segue fluxo normal de SLA); rejeitar em qualquer passo marca todos os passos restantes como `rejeitado` em cascata e `tickets.status = rejeitado`. Reenvio pelo solicitante apaga as linhas antigas e gera um novo conjunto do zero.

### 5.14 `audit_logs`
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| actor_user_id | uuid (FK → users.id) |
| action | varchar(60) | ex: `view_sensitive_field`, `update_collaborator` |
| resource_type | varchar(60) | ex: `collaborator` |
| resource_id | uuid | |
| metadata | jsonb | detalhes (campo acessado, valores antigo/novo se aplicável) |
| created_at | timestamp | |

### 5.15 `integration_outbox`
| Campo | Tipo |
|---|---|
| id | uuid (PK) |
| event_type | varchar(60) | ex: `collaborator.created` |
| payload | jsonb | |
| status | enum(`pending`,`delivered`,`failed`) | |
| attempts | integer | default 0 |
| last_error | text | nullable |
| created_at | timestamp | |
| delivered_at | timestamp | nullable |

### 5.16 `integration_satellites` / `integration_subscriptions`
| Tabela | Campos |
|---|---|
| integration_satellites | id, name (ex: `field_manager`,`logistica`,`financeiro`,`rh`), webhook_url, hmac_secret 🔒, api_key_hash 🔒, status (`active`,`inactive`) |
| integration_subscriptions | satellite_id (FK), event_type — PK composta (quais eventos cada satélite recebe) |

## 6. Rotas / contratos da API REST de integração (v1)

Base: `https://axis.<dominio>/api/v1`

### 6.1 Autenticação service-to-service
- Todas as rotas abaixo exigem header `Authorization: Bearer <api_key_do_satelite>`.
- Rate limit básico por API key (ex: 100 req/min) para evitar abuso.

### 6.2 Consulta de dados mestres (satélite → Axis, síncrono)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/collaborators/:id` | Dados completos do colaborador (sem campos sensíveis, exceto se o satélite tiver permissão explícita — ex: RH) |
| GET | `/collaborators?sector_id=&status=` | Lista paginada, filtrável |
| GET | `/users/:id` | Dados básicos de usuário (id, email, status, roles) |
| GET | `/clients/:id` | Dados do cliente |
| GET | `/clients?code=` | Busca por código |
| GET | `/projects/:id` | Dados do projeto |
| GET | `/projects?client_id=&status=` | Lista paginada, filtrável |
| GET | `/sectors` | Lista de setores |
| GET | `/cost-centers` | Lista de centros de custo |

Todas as respostas de listagem seguem o padrão:
```json
{
  "data": [ ... ],
  "meta": { "page": 1, "per_page": 50, "total": 123 }
}
```

### 6.3 Webhooks (Axis → satélite, assíncrono)

Cada satélite expõe `POST <webhook_url>` configurado no cadastro (`integration_satellites.webhook_url`). Axis envia:

```json
{
  "event_id": "uuid",
  "event_type": "collaborator.created",
  "occurred_at": "2026-10-29T12:00:00Z",
  "payload": { "...": "..." }
}
```

Header `X-Axis-Signature: sha256=<hmac>` (HMAC do body com `hmac_secret` do satélite).

O satélite responde:
- `200 OK` → evento processado (ou já processado antes — idempotência via `event_id`)
- `4xx` → erro permanente (Axis não tenta de novo, marca `failed` e loga)
- `5xx` / timeout → erro transitório (Axis tenta de novo com backoff)

### 6.4 Endpoint de health/registro
| Método | Rota | Descrição |
|---|---|---|
| GET | `/integration/satellites` | (admin only, via painel Axis) Lista satélites cadastrados e status da última entrega |
| POST | `/integration/satellites/:id/test-webhook` | Dispara um evento de teste (`ping`) para validar conectividade |

## 7. Segurança e conformidade (LGPD)

- Criptografia em repouso para CPF/RG/CTPS/PIS/ASO
- Log de auditoria para qualquer leitura/alteração desses campos
- RBAC rígido: só RH/Admin (e o próprio colaborador, parcialmente) acessam dados sensíveis completos
- Backups automáticos do PostgreSQL (rotina na VPS, retenção mínima de 30 dias de backups diários)
- **Retenção de dados pós-desligamento: indefinida** (decisão do usuário) — colaborador desligado não tem dados excluídos, apenas marcado como `offboarded`. Documentar essa decisão na política de privacidade interna da empresa, já que LGPD exige que a retenção tenha finalidade legítima declarada (ex: obrigações trabalhistas/fiscais, defesa em processos) — recomendável formalizar isso num documento de política de retenção de dados da empresa, fora do escopo técnico deste planejamento.

## 8. Pontos abertos — decisões tomadas nesta sessão

| # | Ponto | Decisão |
|---|---|---|
| 1 | Fila de eventos | **Outbox + webhook** (não RabbitMQ) — ver seção 3 |
| 2 | SLA/escalonamento de chamados | **Entra no MVP** — ver seção 4.6 e tabelas `ticket_categories`/`tickets` |
| 3 | Nome do sistema | **Axis** |
| 4 | Multi-tenancy | **Não necessário** — unidade única, sem isolamento por tenant |
| 5 | Volume esperado | **50–300 usuários/colaboradores** → VPS 4 vCPU / 8 GB RAM / 80 GB SSD |
| 6 | Retenção de dados sensíveis pós-desligamento | **Indefinida** — sem expurgo automático, apenas soft-offboarding |

## 9. Roadmap e plano de sprints

Sprints de ~1 semana cada (ajustável). Cada sprint assume codificação com Sonnet 5.5 a partir deste documento, seguido de sessão de testes com Haiku 5.5.

### Fase 1 — Fundação (Sprints 1–2)
- **Sprint 1:** Setup do projeto (NestJS + Prisma + PostgreSQL + Docker Compose), schema inicial (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sectors`, `cost_centers`), migrations, seed de roles padrão.
- **Sprint 2:** Auth (login, JWT, refresh token), RBAC (guards/decorators de permissão), CRUD de Setores e Centro de Custos, módulo de `audit_logs` básico (interceptor de ações sensíveis).

### Fase 2 — Colaboradores (Sprints 3–4)
- **Sprint 3:** CRUD de Colaboradores (campos base), criptografia em repouso dos campos sensíveis (CPF/RG/CTPS/PIS), hierarquia (`supervisor_id`) e endpoint de organograma (árvore montada a partir das relações).
- **Sprint 4:** `technician_certifications` (NR-10/35/12/18) com alertas de vencimento (job agendado), log de acesso a dados sensíveis, tela de colaborador no frontend (incl. organograma visual).

### Fase 3 — Clientes e Projetos (Sprint 5)
- **Sprint 5:** CRUD de Clientes (código sequencial), CRUD de Projetos com geração de código `PROP-{cliente}.{proposta}-{mes}{ano}` (usando `SEQUENCE` atômica do Postgres), vínculos (cliente/centro de custo/responsável), fluxo de status.

### Fase 4 — Chamados (Sprints 6–7)
- **Sprint 6:** `ticket_forms` (schema customizável), `ticket_categories` (com SLA), `tickets` (CRUD, fluxo de status, atribuição), `ticket_comments`/`ticket_attachments`.
- **Sprint 7:** Motor de SLA/escalonamento (job agendado que verifica `sla_due_*` e dispara `ticket.escalated`), notificações (ex: email) de escalonamento, dashboard de chamados por setor.

### Fase 5 — Integração com satélites (Sprint 8)
- **Sprint 8:** Tabela `integration_outbox` + `OutboxDispatcherService` (worker com retry/backoff), `integration_satellites`/`integration_subscriptions`, endpoints de consulta (seção 6.2), geração/rotação de API keys e HMAC secrets, painel admin de satélites (status de entrega, teste de webhook).

### Fase 6 — Hardening e testes (Sprint 9)
- **Sprint 9:** Testes de ponta a ponta (fluxos críticos: criação de colaborador → evento disparado, geração de código de projeto sob concorrência, SLA de chamado), revisão de segurança (RBAC, criptografia, rate limiting), rotina de backup automatizado, documentação de deploy.

## 10. Fluxo de trabalho de desenvolvimento (3 modelos)

1. **Planejamento (Opus 5.5):** este documento — concluído e aprovado nesta sessão.
2. **Codificação (Sonnet 5.5):** implementação sprint a sprint a partir deste plano, em sessão dedicada.
3. **Testes (Haiku 5.5):** escrita e execução de testes (unitários, integração, E2E) por sprint, em sessão dedicada.
