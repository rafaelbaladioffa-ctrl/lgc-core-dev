# LGC — Sistema Satélite de Almoxarifado e Logística

**Integração principal:** Axis ERP | SGI
**Documento:** Especificação funcional e técnica pronta para vibe coding
**Versão:** 1.1 (v1.0 do usuário + seção 0 de amarração com o Axis)
**Localidade:** pt-BR, BRL, `America/Sao_Paulo`
**Status:** aprovado para fase de codificação. Dados fiscais, unidades, alçadas e catálogo definitivo devem ser validados na implantação (ver seção 28).

> Este documento é independente de `PLANNING.md` (Axis core) e `REQUISICOES_SPEC.md` — complementa-os, nunca os substitui. As diretrizes globais de desenvolvimento da seção 1.1 de `PLANNING.md` (padrões pt-BR, formulário, tabela, segurança, consistência visual, regra de autonomia) valem aqui também e não são repetidas.

---

## 0. Amarração com o Axis (decisões de implementação específicas deste satélite)

Esta seção não está na especificação original do usuário — fecha as lacunas de "como" implementar dentro do ecossistema Axis já existente neste repositório. Tudo abaixo de 0.1 a 0.6 é decisão tomada nesta sessão de planejamento; o restante do documento (seções 1–28) é a especificação funcional/técnica fornecida pelo usuário, adotada como está.

### 0.1 Nome e localização do projeto
Diretório próprio, sibling de `lgc-dev-core`: `C:\Users\servidor\Documents\orca-dev\lgc-dev-logistica`. Repositório git próprio. (Nota: já existe `lgc-dev-sys`, um projeto Next.js não relacionado — não reaproveitar nem misturar.)

### 0.2 Stack técnica
Mantida consistente com o Axis (sem motivo forte para divergir, reduz custo cognitivo de manter os dois):

| Camada | Escolha |
|---|---|
| Backend | Node.js + NestJS (TypeScript) |
| Frontend web | React (Vite) |
| App/PWA operacional (seção 15.2) | PWA dentro do mesmo frontend React (sem stack mobile nativa no MVP) — reavaliar React Native/Capacitor só se a leitura de câmera/coletor em campo exigir recurso que PWA não cubra bem |
| Banco de dados | PostgreSQL 16 (instância/schema próprio — nunca o banco do Axis) |
| ORM | Prisma |
| Fila/eventos | Outbox pattern (tabela própria) + webhooks HTTP, mesmo desenho do Axis (seção 3 de `PLANNING.md`) — a especificação do usuário (seção 12) pede outbox transacional + retry exponencial + DLQ, que é exatamente esse padrão |
| Infra | Docker Compose, mesma VPS do Axis (container adicional) |
| Branding | Reaproveita integralmente `branding/` do Axis (tokens, logos, ícones, componente `FormPage`/`FormSection`) — diferenciação mínima: selo "Logística" discreto ao lado do logo Axis no header |

### 0.3 Autenticação — SSO via Axis (revisado após teste ponta a ponta)
A seção 20 do usuário pede "SSO/MFA conforme Axis" sem detalhar o mecanismo. Decisão original: Logística **não** tem tabela de senha própria — valida o mesmo JWT emitido pelo Axis. Isso evoluiu em duas rodadas depois do primeiro teste real:

1. **Login nativo (email/senha):** a tela de login da Logística tem campos normais de email/senha, que chamam diretamente `POST /api/v1/auth/login` do Axis (origem configurável por env; dev: `http://localhost:3000`) via CORS, recebem o JWT de volta e armazenam normalmente. Nunca houve tela de "colar token" na versão final — essa foi uma etapa intermediária, descartada.
2. **Launcher de satélite (atalho vindo do Axis):** o Axis expõe `POST /integration/satellites/:id/launch`, que devolve `{"url": "<frontendUrl>?axisToken=<token>"}` com TTL de 90s. No bootstrap do frontend da Logística, se `axisToken` estiver na querystring, ela é lida, guardada como qualquer token de login normal, e removida da URL imediatamente via `history.replaceState` (nunca fica na barra de endereço/histórico).

RBAC local (perfis da seção 6) é mapeado a partir das `roles` do Axis vindas no token, via tabela própria `axis_role_to_logistics_role` (seed/config, editável sem redeploy do Axis).

**Nomes exatos das variáveis de segredo (ponto que já causou um bug real de 401 em produção/teste — ver nota abaixo):**

| Lado | Variável | Uso |
|---|---|---|
| Axis core | `JWT_ACCESS_SECRET` | assina/valida o access token (é este valor que a Logística precisa) |
| Axis core | `JWT_REFRESH_SECRET` | assina/valida o refresh token — **a Logística nunca usa este, não faz refresh, só revalida o access token a cada request** |
| Logística | `JWT_SECRET` | precisa ter **o mesmo valor** de `JWT_ACCESS_SECRET` do Axis — nomes de variável diferem por repositório, mas o valor tem que ser idêntico nos dois lados, sempre (dev, staging, produção) |

**Bug já encontrado e corrigido:** na primeira implementação, `JWT_SECRET` (Logística) e `JWT_ACCESS_SECRET` (Axis) tinham valores diferentes — login no Axis funcionava (200, token emitido), mas toda chamada autenticada no backend da Logística voltava 401 porque ela validava contra um secret errado. Só foi pego num teste manual de ponta a ponta; os testes automatizados do SSO usavam token mockado e não detectaram. **Lição para deploy:** sempre testar o login ponta a ponta com uma conta real antes de considerar o SSO fechado — mock de JWT não prova que os dois lados compartilham o mesmo secret.

Ponto aberto: se o Axis migrar para RS256/JWKS, Logística troca de secret compartilhado para validação via chave pública sem impacto no modelo de dados — revisar quando/se isso acontecer no core.

**CORS (Axis core):** o login direto (item 1 acima) depende do Axis liberar CORS para a origem do frontend da Logística. O Axis usa uma allow-list via `CORS_ALLOWED_ORIGINS` (env var, lista separada por vírgula); sem ela definida, cai num default de dev que já libera `http://localhost:5173` (Axis) e `http://localhost:5174` (Logística). **Em produção, é obrigatório definir `CORS_ALLOWED_ORIGINS` no Axis com os domínios reais dos dois frontends** — sem isso o fallback de dev não vale e o login direto da Logística para o Axis quebra. Incluir no checklist de deploy (`DEPLOY.md` da Logística e do Axis core).

### 0.4 Eventos Axis → Logística: lacuna a resolver no core
A especificação do usuário (seção 12.2) assume eventos que o Axis **ainda não publica** hoje (`PLANNING.md` seção 3.3 só tem `user.*`, `collaborator.*`, `client.*`, `project.*`, `ticket.*`/`ticket.status_changed`). Faltam no Axis: `material_request.approved`, `material_request.changed`, `material_request.cancel_requested`, `purchase_order.approved`, `purchase_order.changed`, `supplier.changed`, `stock_adjustment.approved`, `disposal.approved`, `cost_center.changed` (pode já ser coberto por reconciliação síncrona em vez de evento), `employee.terminated` (equivalente a `collaborator.offboarded`, já existe — só renomear na integração).

**Decisão de curto prazo (não bloqueia o início da codificação de Logística):** até o Axis publicar os eventos dedicados de requisição de material, Logística consome o evento genérico `ticket.status_changed` já existente (filtrando `category = "Requisição de material/insumo"` / `"Solicitação de compra"` e `status = aberto`) como fonte de `material_request.approved`. Isso é um adaptador interno de Logística (um mapeador de evento legado → evento de domínio interno), não uma mudança de schema. Quando o Axis adicionar os eventos dedicados (recomendação a levar para a sessão do Axis core: adicionar `material_request.*` e `purchase_order.*` ao catálogo de outbox do Axis, idealmente quando a Fase 2/3 de Requisições do Axis — `REQUISICOES_SPEC.md` — tratar essas categorias com alçada/orçamento completos), troca-se o adaptador sem afetar o restante de Logística.

### 0.4.1 Seed do catálogo inicial (gap encontrado no primeiro teste ponta a ponta)
O roadmap de sprints da seção 0.6 nunca incluiu, como tarefa explícita, carregar o catálogo de materiais da seção 8 (EPIs, EPCs, ferramentas, consumíveis, elétrica/TI, limpeza, escritório/embalagem — ~150 SKUs) no banco de desenvolvimento. Resultado: ao final do Sprint 10, schema/API/telas estavam prontos mas o banco `axis_logistica` estava vazio de materiais e sem nenhum warehouse, travando o primeiro teste manual completo (login funcionava, mas não havia o que listar). **Decisão:** o seed de desenvolvimento deve carregar os itens das seções 8.1–8.8 como `materials` reais (8.9, químicos, fica de fora — exige validação técnica/HSE antes de cadastrar, por regra da própria seção 8.9), mais pelo menos 1 warehouse com acesso liberado ao usuário admin de teste, rodando automaticamente no bootstrap do ambiente local — não como passo manual.

### 0.5 Fluxo de trabalho de desenvolvimento (3 modelos, igual ao Axis)
1. **Planejamento (Opus 5.5):** este documento — concluído nesta sessão.
2. **Codificação (Sonnet 5.5):** implementação por fase/sprint a partir deste plano, sessão dedicada, iniciando pela Fase 1 da seção 24 (Fundação e integração).
3. **Testes (Haiku 5.5):** escrita e execução de testes por entrega, sessão dedicada.

### 0.6 Mapeamento Fases → Sprints (para acompanhamento)
A seção 24 do usuário define Fases 0–3. Tradução em sprints de ~1 semana para as sessões de codificação/teste:

- **Sprint 1:** setup do projeto (`lgc-dev-logistica`), schema base (`materials`, `material_versions`, `units_of_measure`, `unit_conversions`, `warehouses`, `locations`), validação de JWT compartilhado (SSO, 0.3), RBAC local.
- **Sprint 2:** ledger (`stock_movements`) + `stock_balances` derivado, `lots`, `serial_numbers`; webhook receiver `POST /webhooks/axis` com HMAC + idempotência; cache de mestres do Axis (`*_cache` para empresa/unidade/usuário/projeto/centro de custo).
- **Sprint 3:** API de catálogo/disponibilidade (13.1), `fulfillment_orders`/`items` + adaptador de `ticket.status_changed` → `material_request.approved` (0.4), reservas (`reservations`).
- **Sprint 4:** picking (`picking_tasks`), embalagem (`packages`), expedição (`shipments`), comprovante de entrega (`delivery_proofs`) — seções 9.4/9.5.
- **Sprint 5:** recebimento (`receipts`/`items`, `inspection_results`), armazenagem/putaway, transferências (`transfers`) — seções 9.2/9.3/9.7.
- **Sprint 6:** devoluções e custódia (`returns`, `custody_terms`) — ferramentas, EPIs, patrimônio (seção 9.6); etiquetas e documentos (seção 16).
- **Sprint 7:** inventário (`stock_counts`) com contagem cega/recontagem, ajustes com aprovação Axis — seção 9.8.
- **Sprint 8:** reposição (`replenishment_suggestions`) — seção 9.9; alertas (seção 19); indicadores/dashboard (seção 18).
- **Sprint 9:** PWA operacional (leitura por câmera, modo offline com fila local, sincronização idempotente) — seção 15.2.
- **Sprint 10:** hardening — cenários de teste obrigatórios (seção 23), auditoria completa (seção 20), reconciliação agendada (12.4), documentação de deploy (novo serviço no `docker-compose.yml` compartilhado da VPS).

**Gap encontrado no primeiro teste ponta a ponta (pós-Sprint 10):** os Sprints 1–10 entregaram backend completo (API) para quase todos os módulos, mas telas web só para o fluxo operacional do PWA (Sprint 9: Separação, Armazenagem, Inventário, Pendências). A seção 15.1 lista 11 telas web esperadas; faltavam Catálogo, Estoque (visão de saldos), Ordens de atendimento/SLA, Recebimentos, Transferências, Devoluções/custódias, Reposição/alertas, Administração (endereços/parâmetros/integrações) e Dashboard operacional. Decisão do usuário: completar essas telas agora, não deixar para depois.

- **Sprint 11:** telas de Catálogo (busca/listagem/detalhe de material, seção 15.1 item 2) e Estoque (saldos por almoxarifado/endereço/lote/série, item 3) — são a base para as demais.
- **Sprint 12:** telas de Recebimento (com divergências, item 5) e Transferências (com trânsito, item 7).
- **Sprint 13:** telas de Devoluções/custódias (item 8). ~~Fornecedores/Ordens de compra~~ — **correção:** conferido contra as seções 3.1–3.3 (regra de ouro de mestre único) e 14 (modelo de dados), fornecedor homologado e pedido de compra são mestre no **Axis**, não em Logística; não existe (nem deveria existir) `suppliers`/`purchase_orders` como entidade própria aqui. O que Logística tem é `replenishment_suggestions` (seção 9.9) — gera sugestão e envia ao Axis, nunca cria pedido de compra autônomo. Esse item foi um erro meu ao propor o Sprint 13; a tela correspondente é a de Reposição/sugestões, já prevista no Sprint 14.
- **Sprint 14:** Dashboard operacional (item 1), Ordens de atendimento/painel de SLA (item 4), Reposição/faltas (item 10), Administração de endereços/parâmetros/integrações (item 11).

**Limitação conhecida (aceitável para o catálogo atual de 101 SKUs, revisar se crescer muito):** a tela de Estoque carrega os primeiros 200 saldos e faz busca/paginação no lado do cliente; não há filtro por texto no backend ainda. Se o catálogo real crescer bem além disso, vale mover a busca para o servidor.

As fases "Avançado" (químicos/certificados, ABC/XYZ, integrações financeiras ampliadas — Fase 3 do usuário) ficam após o Sprint 10, priorizadas conforme uso real pós-piloto.

---

## 1. Visão do produto

Construir um sistema satélite de almoxarifado e logística para controlar o ciclo físico dos materiais, equipamentos, ferramentas, EPIs, consumíveis, ativos e volumes utilizados nas operações da LGC.

O sistema deve funcionar integrado ao Axis ERP | SGI:

1. o usuário abre no Axis uma requisição de material vinculada a empresa, unidade, projeto e centro de custo;
2. o Axis consulta, em tempo real, o catálogo e a disponibilidade publicável do sistema logístico;
3. o Axis executa aprovação e alçada;
4. a requisição aprovada gera reserva ou ordem de atendimento no sistema logístico;
5. o almoxarifado separa, confere, expede e coleta a confirmação de entrega;
6. cada movimentação atualiza o estoque no sistema logístico;
7. eventos e documentos retornam ao Axis para acompanhamento, custos, auditoria e encerramento;
8. falta de estoque pode originar sugestão ou requisição de compra no Axis, sem duplicar o processo de aprovação.

O sistema não deve ser tratado como uma simples lista de produtos. Ele deve oferecer rastreabilidade de ponta a ponta, múltiplos almoxarifados, endereçamento, reservas, lotes, validade, número de série, patrimônio, inventário, transferências, devoluções, logística de campo e integração confiável.

## 2. Objetivos

- manter cadastro mestre único de materiais logísticos;
- mostrar saldo físico, disponível, reservado, em trânsito, bloqueado e projetado;
- garantir que materiais sejam entregues ao projeto, colaborador, veículo, cliente ou local correto;
- reduzir falta, excesso, vencimento, perda e compras emergenciais;
- rastrear lote, validade, série, patrimônio, certificado e custodiante quando aplicável;
- organizar recebimento, armazenagem, separação, expedição, transporte e devolução;
- integrar aprovações e custos ao Axis sem replicar responsabilidades;
- permitir operação móvel por código de barras e QR Code;
- fornecer auditoria, indicadores e evidências para Qualidade, HSE/SST, Financeiro e projetos.

## 3. Limites e responsabilidades dos sistemas

### 3.1 Sistema de Almoxarifado e Logística — mestre

- catálogo de materiais e atributos logísticos;
- categorias, unidades de medida e conversões;
- almoxarifados, depósitos, endereços e capacidades;
- saldos, lotes, validades, séries e patrimônio operacional;
- estoques mínimo, máximo, segurança e ponto de reposição;
- reservas, separação, conferência, expedição e entrega;
- recebimento, inspeção, armazenagem, transferência e devolução;
- inventários, ajustes, bloqueios, avarias e perdas;
- embalagens, volumes, romaneios, rotas e comprovante de entrega;
- etiquetas, códigos de barras e QR Codes;
- movimentações imutáveis e custo logístico recebido do Axis quando autorizado.

### 3.2 Axis ERP | SGI — mestre

- usuários, empresas, unidades e organograma;
- clientes, projetos, contratos e centros de custo;
- fornecedores homologados;
- requisições intersetoriais e aprovações;
- matriz de alçada e orçamento;
- compras, pedidos e contratos de fornecimento;
- financeiro, fiscal e contabilização;
- RH/DP, admissões, desligamentos e vínculos de colaboradores;
- ativos contábeis e depreciação, quando aplicável;
- normas, ocorrências, não conformidades e workflows corporativos.

### 3.3 Regra de ouro

Cada dado deve possuir um único sistema mestre. O sistema consumidor armazena o identificador externo e os dados mínimos necessários para histórico, mas não cria uma segunda verdade editável.

| Dado | Mestre | Consumidor |
|---|---|---|
| Material e atributos logísticos | Logística | Axis |
| Saldo e disponibilidade | Logística | Axis |
| Requisição e aprovação | Axis | Logística |
| Reserva, separação e entrega | Logística | Axis |
| Projeto, centro de custo e usuário | Axis | Logística |
| Fornecedor homologado e pedido de compra | Axis | Logística |
| Recebimento físico | Logística | Axis |
| Documento fiscal e pagamento | Axis | Logística consulta status |
| Movimentação física | Logística | Axis recebe evento/custo |

## 4. Conceitos de estoque

Para cada material, almoxarifado, endereço, lote e condição:

- **saldo físico:** quantidade existente fisicamente;
- **reservado:** comprometido para requisições aprovadas;
- **disponível:** físico liberado menos reservas e bloqueios;
- **bloqueado:** quarentena, inspeção, avaria, vencido ou impedido;
- **em separação:** retirado logicamente para picking, ainda não expedido;
- **em trânsito:** expedido da origem e ainda não recebido no destino;
- **consignado de terceiro:** sob guarda, sem propriedade da LGC;
- **LGC em poder de terceiro:** material da LGC fora de suas instalações;
- **projetado:** disponível + entradas confirmadas − demandas aprovadas futuras.

Nenhum saldo pode ser editado diretamente. Toda alteração decorre de uma movimentação com origem, destino, motivo, usuário e documento.

## 5. Estrutura operacional

### 5.1 Hierarquia

`Empresa → Unidade → Almoxarifado → Área/Zona → Corredor → Estante → Nível → Posição`

Exemplos de zonas:

- recebimento;
- quarentena/inspeção;
- estoque geral;
- EPI e itens controlados;
- ferramentas/equipamentos;
- inflamáveis ou químicos, se autorizados;
- materiais de alto valor;
- devolução/avaria;
- expedição;
- resíduos e descarte;
- estoque de projeto/canteiro;
- estoque móvel em veículo.

### 5.2 Tipos de local

- almoxarifado central;
- almoxarifado de unidade;
- estoque de projeto/obra/campo;
- depósito temporário;
- veículo/estoque móvel;
- consignação;
- local virtual de quarentena, trânsito, perda ou descarte.

### 5.3 Regras de endereço

- endereço possui código legível e QR Code;
- capacidade pode ser controlada por peso, volume, quantidade ou classe;
- endereço pode restringir categoria, risco, temperatura ou acesso;
- um item seriado ocupa localização individual ou agrupada rastreável;
- bloqueios de endereço impedem entrada e separação conforme motivo;
- movimentação física exige leitura da origem e do destino quando a operação usar coletor.

## 6. Perfis e permissões

| Perfil | Capacidades |
|---|---|
| Solicitante Axis | consulta catálogo/disponibilidade permitida e acompanha atendimento no Axis |
| Almoxarife | recebe, armazena, separa, confere, entrega e registra devolução |
| Conferente | valida entrada/saída independentemente quando exigido |
| Gestor de almoxarifado | distribui tarefas, desbloqueia exceções autorizadas e supervisiona inventários |
| Logística/Expedição | cria volumes, romaneios, cargas, rotas e comprovantes de entrega |
| Controle de patrimônio | etiqueta, transfere, custodia e baixa ativos mediante autorização do Axis |
| HSE/Qualidade | inspeciona, bloqueia/libera lotes e consulta certificados conforme escopo |
| Compras | consulta consumo, falta, reposição e recebimento associado ao pedido |
| Auditor | leitura de documentos, movimentos e trilha sem alteração |
| Administrador de catálogo | mantém materiais e parâmetros em fluxo de aprovação |
| Administrador técnico | configura integrações sem acesso automático a operações restritas |

Regras:

- autorização por empresa, unidade, almoxarifado, zona, operação e categoria;
- quem solicita ou separa não confirma sozinho uma exceção sensível quando houver segregação;
- ajustes, baixas, perdas e estoques negativos exigem permissão específica e alçada do Axis;
- toda autorização é validada no backend;
- usuários desligados perdem acesso e itens em custódia geram pendência de devolução.

## 7. Cadastro mestre de materiais

### 7.1 Identificação obrigatória

| Campo | Regra |
|---|---|
| `id` | UUID imutável |
| código interno | único, ex.: `EPI-CAP-0001` |
| descrição curta | padronizada e pesquisável |
| descrição técnica | especificação sem marca obrigatória, salvo justificativa |
| categoria/subcategoria | taxonomia controlada |
| tipo | consumo, ferramenta, equipamento, ativo, embalagem, químico, EPI, EPC, sobressalente |
| unidade de estoque | UN, CX, PCT, KG, L, M, M², M³, PAR, ROLO etc. |
| unidades de compra/entrega | com fator de conversão versionado |
| fabricante/marca/modelo | opcionais ou homologados conforme criticidade |
| código do fabricante | quando aplicável |
| GTIN/EAN/código de barras | múltiplos códigos permitidos |
| NCM/CEST/origem fiscal | mantidos/validados pelo Axis quando necessários |
| ativo/inativo/substituído | item inativo não recebe novas operações |
| item substituto/equivalente | equivalência exige validação técnica |

### 7.2 Controles logísticos

- controle por lote;
- validade e vida útil mínima no recebimento;
- número de série;
- patrimônio;
- certificado/calibração;
- CA de EPI e validade do CA;
- grade de tamanho, cor, voltagem ou dimensão;
- peso e dimensões unitárias;
- condição de armazenagem;
- classe de risco/incompatibilidade;
- método de saída FIFO, FEFO ou série específica;
- estoque mínimo, máximo, segurança e ponto de reposição por local;
- múltiplo de compra, embalagem e separação;
- lead time de reposição;
- criticidade operacional A/B/C e classificação XYZ de demanda;
- exige autorização HSE, Qualidade, TI ou gestor;
- retornável, reparável, calibrável, locado ou descartável;
- custo médio e último custo recebidos do Axis, conforme permissão.

### 7.3 Governança do cadastro

1. solicitação de novo item nasce no Axis ou em fila integrada;
2. o sistema pesquisa possíveis duplicidades por descrição, código, GTIN e atributos;
3. área técnica define especificação;
4. HSE/Qualidade/Fiscal valida quando aplicável;
5. cadastro é aprovado e publicado;
6. alteração material cria versão e evento para o Axis;
7. item não é excluído se possuir histórico; é inativado ou substituído.

## 8. Catálogo inicial de materiais da operação LGC

O catálogo abaixo é uma semente para implantação. Marcas, modelos, tamanhos, CAs, normas, quantidades mínimas e códigos definitivos devem ser confirmados pela LGC. Cada variação controlada pode ser um SKU próprio.

### 8.1 EPIs

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| EPI-CAP-0001 | Capacete de segurança com jugular | UN | cor/tamanho, CA, lote, validade |
| EPI-OCU-0001 | Óculos de segurança incolor | UN | CA, lote |
| EPI-OCU-0002 | Óculos de segurança escuro | UN | CA, lote |
| EPI-AUD-0001 | Protetor auricular plug | PAR | CA, lote, descartável |
| EPI-AUD-0002 | Protetor auricular tipo concha | UN | CA, patrimônio opcional |
| EPI-RES-0001 | Respirador semifacial | UN | CA, tamanho, retornável |
| EPI-RES-0002 | Filtro para respirador | PAR | tipo, lote, validade |
| EPI-MAS-0001 | Máscara descartável PFF2 | UN | CA, lote, validade |
| EPI-LUV-0001 | Luva de vaqueta | PAR | tamanho, CA |
| EPI-LUV-0002 | Luva nitrílica reutilizável | PAR | tamanho, CA, compatibilidade química |
| EPI-LUV-0003 | Luva nitrílica descartável | CX | tamanho, lote, validade |
| EPI-LUV-0004 | Luva anticorte | PAR | tamanho, nível de proteção, CA |
| EPI-CAL-0001 | Botina de segurança | PAR | numeração, CA, biqueira |
| EPI-CAL-0002 | Bota PVC | PAR | numeração/cano, CA |
| EPI-VES-0001 | Colete refletivo | UN | tamanho/cor |
| EPI-UNI-0001 | Uniforme operacional — camisa | UN | tamanho, modelo, colaborador |
| EPI-UNI-0002 | Uniforme operacional — calça | UN | tamanho, modelo, colaborador |
| EPI-ALT-0001 | Cinturão paraquedista | UN | série, CA, inspeção, validade |
| EPI-ALT-0002 | Talabarte duplo com absorvedor | UN | série, CA, inspeção, validade |
| EPI-ALT-0003 | Trava-quedas | UN | série, CA, inspeção |
| EPI-CHU-0001 | Capa de chuva | UN | tamanho, CA quando aplicável |
| EPI-SOL-0001 | Protetor solar | UN | fator, lote, validade |

### 8.2 EPCs, sinalização e emergência

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| EPC-CON-0001 | Cone de sinalização | UN | tamanho, faixa refletiva, retornável |
| EPC-FIT-0001 | Fita zebrada | ROLO | metragem |
| EPC-PLA-0001 | Placa de sinalização | UN | texto/pictograma/dimensão |
| EPC-CAV-0001 | Cavalete de sinalização | UN | retornável |
| EPC-COR-0001 | Corrente plástica para isolamento | M | cor |
| EPC-GRA-0001 | Grade/barreira de isolamento | UN | dimensão, retornável |
| EPC-EXT-0001 | Extintor portátil | UN | tipo/carga, patrimônio, validade/inspeção |
| EPC-KIT-0001 | Kit de primeiros socorros | KIT | composição, lote, validade |
| EPC-DER-0001 | Kit de contenção de derramamento | KIT | absorção, validade quando aplicável |
| EPC-ILU-0001 | Iluminação de emergência portátil | UN | série, patrimônio, inspeção |

### 8.3 Ferramentas manuais

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| FER-CHA-0001 | Jogo de chaves combinadas | JG | retornável, custodiante |
| FER-CHA-0002 | Jogo de chaves Allen | JG | retornável |
| FER-FEN-0001 | Chave de fenda/Phillips | UN | medida, retornável |
| FER-ALI-0001 | Alicate universal | UN | retornável |
| FER-ALI-0002 | Alicate de corte | UN | retornável |
| FER-MAR-0001 | Martelo | UN | peso, retornável |
| FER-TRE-0001 | Trena | UN | comprimento, retornável/calibração conforme uso |
| FER-NIV-0001 | Nível manual | UN | dimensão, retornável |
| FER-EST-0001 | Estilete de segurança | UN | retornável/controlado |
| FER-CAI-0001 | Caixa de ferramentas | UN | patrimônio/custodiante |
| FER-ESC-0001 | Escada portátil | UN | patrimônio, inspeção periódica |

### 8.4 Ferramentas elétricas e equipamentos portáteis

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| EQP-FUR-0001 | Furadeira/parafusadeira | UN | série, patrimônio, voltagem, manutenção |
| EQP-ESM-0001 | Esmerilhadeira | UN | série, patrimônio, diâmetro/voltagem |
| EQP-SER-0001 | Serra elétrica portátil | UN | série, patrimônio, inspeção |
| EQP-ASP-0001 | Aspirador industrial | UN | série, patrimônio, voltagem |
| EQP-LAV-0001 | Lavadora de alta pressão | UN | série, patrimônio, manutenção |
| EQP-GER-0001 | Gerador portátil | UN | série, patrimônio, combustível, horímetro |
| EQP-COM-0001 | Compressor portátil | UN | série, patrimônio, inspeção |
| EQP-EXT-0001 | Extensão elétrica industrial | UN | comprimento, tensão, inspeção |
| EQP-MUL-0001 | Multímetro | UN | série, patrimônio, calibração |
| EQP-DET-0001 | Detector/medidor portátil | UN | tipo, série, calibração, bateria |

### 8.5 Consumíveis operacionais e manutenção

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| CON-DIS-0001 | Disco de corte | UN | diâmetro, aplicação, validade quando indicada |
| CON-DIS-0002 | Disco de desbaste | UN | diâmetro/aplicação |
| CON-BRO-0001 | Broca | UN | material/diâmetro |
| CON-LIX-0001 | Lixa | UN | grão/dimensão |
| CON-FIT-0001 | Fita isolante | ROLO | cor/classe |
| CON-FIT-0002 | Fita dupla face/adesiva | ROLO | largura/aplicação |
| CON-ABR-0001 | Abraçadeira de nylon | PCT | dimensão/cor |
| CON-LUB-0001 | Lubrificante/desengripante | UN | volume, lote, validade, FISPQ/SDS |
| CON-GRA-0001 | Graxa | KG | tipo, lote, validade, SDS |
| CON-SEL-0001 | Selante/silicone | UN | cor, lote, validade, SDS |
| CON-PIL-0001 | Pilha | PCT | tipo, lote/validade |
| CON-BAT-0001 | Bateria portátil | UN | tipo, capacidade, descarte controlado |
| CON-PAR-0001 | Parafuso | UN/CX | material, rosca e dimensão |
| CON-POR-0001 | Porca | UN/CX | rosca e dimensão |
| CON-ARR-0001 | Arruela | UN/CX | tipo e dimensão |

### 8.6 Elétrica, redes e TI de campo

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| ELE-CAB-0001 | Cabo elétrico | M/ROLO | bitola, cor, classe |
| ELE-PLU-0001 | Plugue/tomada industrial | UN | corrente, tensão, polos |
| ELE-DIS-0001 | Disjuntor | UN | curva, corrente, polos |
| ELE-TER-0001 | Terminal/conector elétrico | PCT | bitola/tipo |
| RED-CAB-0001 | Cabo de rede | M/CX | categoria, lote |
| RED-PAT-0001 | Patch cord | UN | categoria/comprimento/cor |
| RED-CON-0001 | Conector RJ45 | PCT | categoria |
| TI-MOU-0001 | Mouse | UN | patrimônio opcional |
| TI-TEC-0001 | Teclado | UN | patrimônio opcional |
| TI-FON-0001 | Headset | UN | série/custodiante |
| TI-CAR-0001 | Carregador/fonte | UN | modelo, tensão, compatibilidade |
| TI-NOT-0001 | Notebook | UN | série, patrimônio, custodiante, integração TI |
| TI-CEL-0001 | Smartphone/tablet | UN | IMEI/série, patrimônio, custodiante |

### 8.7 Limpeza, conservação e apoio

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| LIM-DET-0001 | Detergente | L/UN | lote, validade, SDS quando aplicável |
| LIM-DES-0001 | Desinfetante | L/UN | lote, validade |
| LIM-ALC-0001 | Álcool 70% | L/UN | lote, validade, inflamável |
| LIM-PAP-0001 | Papel toalha | PCT/FD | embalagem |
| LIM-SAC-0001 | Saco para resíduos | PCT | cor/capacidade/classe |
| LIM-PAN-0001 | Pano de limpeza | PCT | tipo |
| LIM-VAS-0001 | Vassoura | UN | tipo |
| LIM-ROD-0001 | Rodo | UN | dimensão |
| LIM-BAL-0001 | Balde | UN | capacidade |
| LIM-ABS-0001 | Absorvente industrial | PCT | capacidade/aplicação |

### 8.8 Escritório, identificação e embalagem

| Código sugerido | Material | UM | Controles recomendados |
|---|---|---:|---|
| ESC-PAP-0001 | Papel A4 | RESMA | gramatura |
| ESC-CAN-0001 | Caneta | UN/CX | cor/tipo |
| ESC-MAR-0001 | Marcador permanente | UN | cor |
| ESC-ETI-0001 | Etiqueta | ROLO/PCT | dimensão/material |
| ESC-TON-0001 | Toner/cartucho | UN | compatibilidade, lote |
| EMB-CAI-0001 | Caixa de papelão | UN | dimensões/capacidade |
| EMB-FIL-0001 | Filme stretch | ROLO | largura/espessura |
| EMB-FIT-0001 | Fita para embalagem | ROLO | largura |
| EMB-PLA-0001 | Palete | UN | tipo/dimensão, retornável |
| EMB-LAC-0001 | Lacre numerado | UN | numeração individual |

### 8.9 Produtos químicos e controlados

Só cadastrar após validação técnica e de HSE.

- tintas, solventes, desengraxantes e adesivos;
- combustíveis e lubrificantes;
- gases e cilindros;
- produtos de tratamento/limpeza técnica;
- aerossóis e inflamáveis;
- baterias e resíduos perigosos.

Campos adicionais: composição, SDS/FISPQ, ONU, classe de risco, incompatibilidades, armazenamento, EPI requerido, lote, validade, licença e plano de emergência.

## 9. Processos funcionais

### 9.1 Solicitação e reserva a partir do Axis

1. Axis solicita catálogo filtrado por unidade, projeto e permissão.
2. Logística retorna SKU, descrição, UM, variantes, disponibilidade publicável e previsão.
3. Usuário adiciona materiais e quantidades no Axis.
4. Axis valida projeto, centro de custo, justificativa e aprovação.
5. Após aprovação, Axis envia `material_request.approved` com versão e chave idempotente (no MVP, via adaptador do evento `ticket.status_changed` existente — ver seção 0.4).
6. Logística valida referências e cria ordem de atendimento.
7. Política define reserva imediata, fila para análise ou atendimento parcial.
8. Logística devolve número, itens reservados, faltas e previsão.
9. Axis exibe o progresso sem permitir editar a execução física.

Regras:

- consulta no Axis nunca reduz saldo;
- carrinho não equivale a reserva;
- aprovação sem confirmação de reserva não promete disponibilidade;
- reserva expira conforme categoria e data necessária;
- alteração de quantidade no Axis gera nova versão; se já houver picking, exige análise;
- substituto só pode ser usado quando tecnicamente autorizado e aceito pelo solicitante/regra.

### 9.2 Recebimento

Fluxo: agendamento → chegada → conferência documental → conferência física → inspeção → recebimento → endereçamento.

Campos: pedido Axis, fornecedor, NF/romaneio, veículo, volumes, item, quantidade, lote, validade, série, condição, divergência, fotos, certificados e responsável.

- recebimento sem pedido exige exceção aprovada;
- divergência de quantidade/preço/documento gera ocorrência para Compras no Axis;
- material sujeito a inspeção entra em quarentena;
- validade mínima e certificado são validados antes da liberação;
- séries não podem duplicar;
- sistema emite etiqueta interna e tarefa de armazenagem;
- Axis recebe confirmação física; liberação fiscal/financeira continua no Axis.

### 9.3 Armazenagem

- sugerir endereço por categoria, compatibilidade, giro, capacidade e FEFO;
- confirmar item e endereço por leitura;
- impedir mistura incompatível ou endereço sem capacidade;
- registrar operador, horário e percurso;
- permitir reabastecimento de endereço de picking a partir do pulmão.

### 9.4 Separação, conferência e expedição

1. onda/tarefa de picking por prioridade, rota, projeto ou data;
2. estratégia FEFO/FIFO/série conforme item;
3. leitura do endereço, item, lote/série e quantidade;
4. divergência exige motivo e tratamento;
5. conferência independente quando exigida;
6. embalagem, peso, dimensões, lacre e identificação dos volumes;
7. romaneio e expedição;
8. atualização para `EM_TRANSITO` ou entrega local;
9. evento detalhado para o Axis.

### 9.5 Entrega e consumo

- entrega a colaborador: identificação, aceite e custódia quando retornável;
- entrega a projeto/local: recebedor autorizado, data, geolocalização opcional e comprovante;
- EPI: colaborador, CA, lote, tamanho, data e termo;
- ativo/ferramenta: patrimônio/série, condição, custodiante e devolução prevista;
- consumível: baixa para projeto/centro de custo somente após entrega confirmada;
- entrega parcial mantém saldo pendente e informa previsão.

### 9.6 Devolução

Tipos: sobra não utilizada, ferramenta, ativo, item defeituoso, avaria, troca de tamanho, retorno de projeto ou retorno de terceiro.

Inspeção classifica:

- disponível para uso;
- requer limpeza/manutenção/calibração;
- quarentena;
- avariado com possibilidade de reparo;
- sucata/descarte, sujeito a aprovação.

### 9.7 Transferência

- ordem entre locais com reserva na origem;
- separação e expedição geram estoque em trânsito;
- recebimento no destino encerra trânsito;
- divergência abre ocorrência e não ajusta automaticamente;
- transferência urgente pode usar fluxo simplificado com auditoria;
- nunca baixar da origem e aumentar destino sem documento de trânsito.

### 9.8 Inventário

Tipos: geral, rotativo ABC, por endereço, item, lote, projeto ou amostragem.

- congelamento lógico ou controle de movimentos concorrentes;
- primeira contagem cega;
- recontagem por operador diferente conforme tolerância;
- divergência apurada por lote/série/condição;
- ajuste somente após aprovação do Axis conforme valor e motivo;
- relatório antes/depois e trilha completa;
- plano de ação para recorrência.

### 9.9 Reposição

- calcular ponto de reposição por consumo, lead time, estoque de segurança e demanda futura aprovada;
- gerar sugestão, nunca pedido financeiro autônomo;
- consolidar necessidade por item, local, projeto e data;
- enviar ao Axis solicitação de compra com justificativa e evidências;
- receber pedido aprovado e previsão do Axis;
- evitar nova sugestão enquanto houver compra/transferência suficiente em aberto.

### 9.10 Avaria, perda, vencimento e descarte

- bloquear imediatamente a quantidade afetada;
- registrar motivo, fotos, lote/série, responsável e valor estimado;
- abrir ocorrência/aprovação no Axis;
- descarte exige autorização, método, fornecedor/destinador e certificado quando aplicável;
- saída física somente após autorização;
- impedir uso de item vencido ou bloqueado, salvo exceção formal tecnicamente permitida.

## 10. Estados principais

### 10.1 Ordem de atendimento

`RECEBIDA` → `EM_ANALISE` → `RESERVADA`/`RESERVADA_PARCIAL` → `LIBERADA_SEPARACAO` → `EM_SEPARACAO` → `SEPARADA` → `EM_CONFERENCIA` → `PRONTA_EXPEDICAO` → `EXPEDIDA` → `ENTREGUE` → `ENCERRADA`

Alternativos: `AGUARDANDO_ESTOQUE`, `AGUARDANDO_INFORMACAO`, `BLOQUEADA`, `CANCELAMENTO_SOLICITADO`, `CANCELADA` e `DIVERGENCIA`.

### 10.2 Recebimento

`AGENDADO` → `EM_CONFERENCIA` → `RECEBIDO_PENDENTE_INSPECAO` → `LIBERADO` → `ARMAZENADO`

Alternativos: `DIVERGENTE`, `QUARENTENA`, `REJEITADO` e `DEVOLVIDO_FORNECEDOR`.

### 10.3 Transferência

`SOLICITADA` → `APROVADA` → `SEPARANDO` → `EXPEDIDA` → `EM_TRANSITO` → `RECEBIDA` → `ENCERRADA`.

## 11. Regras críticas de negócio

1. Movimentação confirmada é imutável; correção ocorre por movimento reverso vinculado.
2. Estoque negativo é proibido por padrão.
3. Quantidade usa decimal conforme precisão da unidade; item unitário/seriado exige inteiro.
4. Conversão de unidade usa fator versionado e arredondamento explícito.
5. FEFO é obrigatório para itens com validade, salvo série/lote determinado e justificativa.
6. Item vencido, bloqueado ou em quarentena não compõe disponível.
7. Número de série é único dentro do escopo definido e não pode existir simultaneamente em dois locais.
8. Reserva possui origem Axis, versão e validade.
9. Cancelamento não desfaz automaticamente picking ou expedição; gera tarefa de retorno.
10. Entrega parcial requer aceite da regra e mantém pendência.
11. Substituição preserva SKU solicitado e SKU entregue.
12. Ajustes exigem motivo padronizado; acima da tolerância/valor, aprovação Axis.
13. Custódia de ferramenta, EPI controlado ou ativo exige identificação do recebedor.
14. Desligamento recebido do Axis bloqueia novas entregas e lista pendências de devolução.
15. Materiais de clientes ou terceiros têm propriedade separada e nunca se misturam contabilmente.
16. O sistema mantém histórico do custo recebido, mas não recalcula contabilidade oficial.
17. Toda operação offline precisa sincronizar com idempotência e tratamento de conflito.

## 12. Integração com o Axis

### 12.1 Padrão

- APIs REST para consulta/comandos síncronos;
- eventos/webhooks para atualização assíncrona;
- OAuth 2.0 client credentials ou padrão corporativo do Axis (no MVP: API key de serviço + JWT compartilhado para SSO, ver seção 0.3 — equivalente funcional, migrar para OAuth2 formal é item de evolução);
- mTLS quando disponível;
- `Idempotency-Key` em comandos;
- `correlation_id`, `causation_id`, versão do evento e timestamp;
- outbox transacional, retentativas exponenciais e dead-letter queue;
- assinatura de webhook e proteção contra replay;
- reconciliação agendada entre requisições, reservas, recebimentos e movimentos.

### 12.2 Axis → Logística

| Evento/comando | Finalidade |
|---|---|
| `master.company.changed` | sincronizar empresa/unidade |
| `master.user.changed` | usuário, vínculo, gestor e status (hoje: `user.created`/`user.updated`/`user.disabled` do Axis) |
| `project.changed` | projeto, cliente, datas e status (hoje: `project.created`/`project.status_changed`) |
| `cost_center.changed` | centro de custo permitido (hoje: não publicado como evento — resolver por reconciliação síncrona via `GET /cost-centers` até o Axis publicar) |
| `supplier.changed` | fornecedor e homologação (não publicado hoje — depende do Axis ter cadastro de fornecedores homologados; ver seção 0.4) |
| `purchase_order.approved` | permitir recebimento contra pedido (não publicado hoje — ver seção 0.4) |
| `purchase_order.changed` | atualizar itens, saldos e previsão (não publicado hoje) |
| `material_request.approved` | criar ordem/reserva (MVP via adaptador de `ticket.status_changed`, ver seção 0.4) |
| `material_request.changed` | aplicar nova versão ou solicitar análise (idem) |
| `material_request.cancel_requested` | avaliar cancelamento físico (idem) |
| `stock_adjustment.approved` | autorizar ajuste inventarial (não publicado hoje — fluxo manual via tela de aprovação cruzada até existir) |
| `disposal.approved` | autorizar descarte/baixa física (idem) |
| `employee.terminated` | bloquear entregas e gerar pendências (hoje: `collaborator.offboarded`) |

### 12.3 Logística → Axis

| Evento | Finalidade |
|---|---|
| `material.changed` | publicar cadastro/versão |
| `availability.changed` | invalidar cache e atualizar disponibilidade |
| `fulfillment.created` | confirmar ordem logística |
| `reservation.confirmed/partial/failed` | informar compromisso de estoque |
| `picking.started/completed` | progresso operacional |
| `shipment.dispatched` | romaneio, volumes e trânsito |
| `delivery.confirmed/partial/refused` | comprovar entrega |
| `receipt.confirmed/divergent` | confirmar recebimento físico |
| `inventory.variance_detected` | solicitar análise/aprovação |
| `stock.movement.posted/reversed` | refletir consumo/custo e auditoria |
| `replenishment.suggested` | iniciar compra/transferência |
| `asset.custody.changed` | atualizar custodiante |
| `lot.blocked/released` | risco e indisponibilidade |

### 12.4 Consistência e falhas

- sistemas não compartilham tabelas de banco;
- uma falha do Axis não interrompe movimentação segura já autorizada; evento fica pendente;
- uma falha logística impede o Axis de afirmar que houve reserva ou entrega;
- comandos repetidos retornam o resultado original;
- eventos fora de ordem são controlados por versão do agregado;
- divergência gera fila de reconciliação, nunca correção silenciosa;
- cache de catálogo no Axis deve mostrar momento da última atualização;
- disponibilidade exibida no Axis é informativa até a reserva confirmada.

## 13. API do sistema logístico

Prefixo sugerido: `/api/v1`.

### 13.1 Catálogo e disponibilidade

- `GET /materials?q=&category=&active=&page_cursor=`
- `GET /materials/{id}`
- `GET /materials/{id}/availability?unit_id=&project_id=&needed_by=`
- `POST /materials/availability:batch`
- `GET /material-categories`
- `GET /warehouses/{id}/stock`

Resposta de disponibilidade:

```json
{
  "material_id": "uuid",
  "sku": "EPI-CAP-0001",
  "stock_unit": "UN",
  "physical": "120",
  "reserved": "35",
  "blocked": "5",
  "available": "80",
  "projected_on_needed_by": "100",
  "as_of": "2026-10-31T18:00:00Z"
}
```

### 13.2 Atendimento

- `POST /fulfillment-orders` — recebe requisição aprovada do Axis.
- `GET /fulfillment-orders/{id}`
- `POST /fulfillment-orders/{id}/reserve`
- `POST /fulfillment-orders/{id}/release-picking`
- `POST /picking-tasks/{id}/scan`
- `POST /fulfillment-orders/{id}/pack`
- `POST /shipments/{id}/dispatch`
- `POST /shipments/{id}/confirm-delivery`
- `POST /fulfillment-orders/{id}/cancel-request`

### 13.3 Recebimento e estoque

- `POST /receipts`
- `POST /receipts/{id}/items:scan`
- `POST /receipts/{id}/complete`
- `POST /putaway-tasks/{id}/confirm`
- `POST /transfers`
- `POST /transfers/{id}/dispatch`
- `POST /transfers/{id}/receive`
- `POST /returns`
- `POST /stock-counts`
- `POST /stock-counts/{id}/counts`
- `POST /stock-adjustments` — exige autorização Axis quando aplicável.
- `GET /stock-movements`

### 13.4 Erros

Usar Problem Details e mensagens em português. Códigos mínimos: `INSUFFICIENT_STOCK`, `LOT_BLOCKED`, `SERIAL_DUPLICATE`, `INVALID_LOCATION`, `REQUEST_VERSION_CONFLICT`, `AXIS_REFERENCE_INVALID`, `INSPECTION_REQUIRED`, `APPROVAL_REQUIRED` e `UNIT_CONVERSION_ERROR`.

## 14. Modelo de dados mínimo

| Entidade | Conteúdo principal |
|---|---|
| `materials` | SKU, descrições, tipo, categoria, UM, status, controles |
| `material_versions` | especificação e atributos versionados |
| `material_barcodes` | GTIN, código interno, embalagem e fator |
| `units_of_measure` | código, precisão e dimensão |
| `unit_conversions` | material, origem, destino, fator e vigência |
| `warehouses` | empresa, unidade, tipo e responsável |
| `locations` | hierarquia, capacidade, restrições e status |
| `lots` | material, lote, fabricação, validade, status e fornecedor |
| `serial_numbers` | material, série, patrimônio, condição e localização |
| `stock_balances` | dimensão de estoque e quantidades derivadas/otimizadas |
| `stock_movements` | ledger imutável de entradas, saídas, reservas e transferências |
| `reservations` | origem Axis, item, quantidade, lote/série e expiração |
| `fulfillment_orders/items` | requisição Axis, projeto, CC, destinatário e estados |
| `picking_tasks/items` | rota de separação e confirmações |
| `packages` | volume, peso, dimensões, lacre e conteúdo |
| `shipments` | origem, destino, transportador, rota, romaneio e status |
| `delivery_proofs` | recebedor, data, assinatura/foto e posição opcional |
| `receipts/items` | pedido Axis, fornecedor, NF, quantidades e divergências |
| `inspection_results` | checklist, decisão, certificados e responsável |
| `transfers` | origem, destino, itens e trânsito |
| `returns` | origem, itens, condição e destinação |
| `stock_counts` | escopo, contagens, divergências e aprovações |
| `custody_terms` | pessoa/projeto, item seriado, entrega e devolução |
| `replenishment_suggestions` | demanda, cálculo, recomendação e retorno Axis |
| `integration_messages` | inbox/outbox, versão, tentativas e resultado |
| `audit_events` | ator, ação, agregado, diff, origem e correlação |

### 14.1 Ledger de movimentos

Cada movimento registra:

- ID e código;
- material, quantidade e UM;
- lote, série/patrimônio quando aplicável;
- local origem e destino;
- condição/propriedade;
- tipo e motivo;
- documento de origem Axis e documento logístico;
- projeto, centro de custo, cliente e custodiante quando aplicáveis;
- usuário/dispositivo, data efetiva e data de registro;
- custo unitário histórico recebido do Axis;
- movimento revertido/vinculado;
- `correlation_id` e chave idempotente.

## 15. Interface web e móvel

### 15.1 Web

1. Dashboard operacional.
2. Catálogo de materiais.
3. Estoque por almoxarifado/endereço/lote/série.
4. Ordens de atendimento e painel de SLA.
5. Recebimentos e divergências.
6. Separação, conferência e expedição.
7. Transferências e trânsito.
8. Devoluções e custódias.
9. Inventários e ajustes.
10. Reposição e faltas.
11. Administração de endereços, parâmetros e integrações.

### 15.2 Aplicativo/PWA operacional

- login corporativo e seleção do almoxarifado;
- leitura por câmera ou coletor;
- tarefas ordenadas por prioridade e rota;
- telas de alto contraste, botões grandes e uso com luvas quando necessário;
- confirmação por leitura, quantidade e condição;
- fotos, assinatura e comprovante;
- modo offline controlado com fila local criptografada;
- sincronização visível, idempotente e sem esconder conflitos;
- proibir operação offline de alto risco configurada.

### 15.3 Padrões brasileiros

- moeda `R$ 1.234,56`;
- datas `DD/MM/AAAA` e horário 24h;
- quantidades formatadas conforme precisão da UM;
- peso em kg e dimensões conforme configuração;
- mensagens de erro em português e próximas da ação.

## 16. Etiquetas e documentos

### 16.1 Etiquetas

- material/SKU e descrição;
- código de barras/QR Code;
- lote, validade e série;
- patrimônio quando aplicável;
- quantidade e UM;
- endereço;
- status de inspeção/bloqueio;
- etiqueta de volume com destino, ordem, projeto e sequência.

Formatos configuráveis para impressora térmica, com reimpressão auditada e motivo.

### 16.2 Documentos

- comprovante de recebimento;
- relatório de divergência;
- lista de separação;
- romaneio de expedição/transferência;
- termo de entrega e custódia;
- comprovante de entrega;
- relatório de inventário;
- certificado de descarte/devolução;
- extrato de movimentações.

## 17. SLA operacional sugerido

| Processo | Meta inicial sugerida |
|---|---|
| confirmação de requisição integrada | até 5 minutos |
| reserva de item disponível | até 15 minutos automática ou 2h manual |
| separação urgente aprovada | até 2h |
| separação normal em estoque | até 1 dia útil |
| recebimento físico inicial | no mesmo dia da chegada |
| conferência/inspeção comum | até 1 dia útil |
| devolução e classificação | até 2 dias úteis |
| transferência interna | conforme rota; confirmação no destino obrigatória |
| tratamento de divergência crítica | resposta em 4h |

Calendários, prioridades e contratos devem ser configuráveis. Espera por aprovação no Axis não deve ser atribuída ao SLA do almoxarifado.

## 18. Indicadores

- acuracidade de estoque física e sistêmica;
- nível de serviço/fill rate e atendimento completo no prazo;
- tempo entre aprovação, reserva, picking, expedição e entrega;
- itens em falta, ruptura e demanda reprimida;
- cobertura e giro de estoque;
- excesso, obsolescência e vencimento próximo;
- consumo por projeto, centro de custo, cliente, unidade e colaborador;
- compras emergenciais e causas;
- divergências de recebimento por fornecedor;
- produtividade e erros por processo, sem uso isolado para punição individual;
- perdas, avarias e ajustes por motivo;
- itens em custódia e devoluções vencidas;
- ocupação de endereço e capacidade;
- transferências em trânsito e tempo de rota;
- saúde da integração, eventos pendentes e divergências de reconciliação.

## 19. Alertas e automações

- estoque abaixo do mínimo/ponto de reposição;
- previsão de ruptura considerando demandas aprovadas;
- lote próximo do vencimento em 90/60/30/7 dias;
- CA, certificado, calibração ou inspeção a vencer;
- reserva próxima de expirar;
- requisição sem movimento dentro do SLA;
- material bloqueado ainda reservado;
- trânsito não recebido no prazo;
- custódia/devolução vencida;
- divergência de inventário acima da tolerância;
- falha de integração ou mensagem em dead-letter;
- consumo anômalo comparado ao histórico, para análise humana.

Alertas críticos devem aparecer no sistema e ser enviados ao papel responsável. Notificação não concede acesso ao registro.

## 20. Segurança, auditoria e LGPD

- SSO/MFA conforme Axis (ver implementação em 0.3);
- RBAC com escopo operacional;
- TLS, criptografia em repouso e gestão segura de segredos;
- logs sem tokens, documentos completos ou dados pessoais desnecessários;
- assinatura/foto/geolocalização apenas quando necessária, com retenção definida;
- auditoria append-only de cadastro, saldo, movimentos, aprovações, etiquetas, exportações e acesso sensível;
- anexos com varredura antimalware, hash e controle de versão;
- rate limit, proteção contra injection, XSS, CSRF, SSRF e replay;
- backups testados, plano de continuidade e restauração;
- ambientes de teste sem cópia desprotegida de dados reais.

## 21. Requisitos não funcionais

- disponibilidade alvo definida conforme criticidade operacional;
- p95 de consulta comum ≤ 2 s; leitura de código e confirmação online ≤ 1 s na rede operacional, salvo integração;
- paginação e índices obrigatórios;
- ledger transacional e consistência forte na confirmação de movimentos;
- processamento assíncrono para eventos, relatórios e integrações;
- observabilidade com logs, métricas, tracing e `correlation_id`;
- PWA responsiva e acessível; suporte aos navegadores/dispositivos homologados;
- arquitetura preparada para múltiplas empresas, unidades e almoxarifados;
- feature flags e implantação gradual;
- migrações compatíveis e plano de rollback;
- horários armazenados em UTC e exibidos em `America/Sao_Paulo`.

## 22. Critérios de aceite

### 22.1 Catálogo

- [ ] Material possui código único, categoria, UM e controles logísticos.
- [ ] Duplicidades prováveis são alertadas antes da criação.
- [ ] Item seriado, por lote, validade, CA ou calibração exige os campos configurados.
- [ ] Alterações materiais são versionadas e publicadas ao Axis.
- [ ] Item com histórico é inativado, não apagado.

### 22.2 Integração Axis

- [ ] Axis consulta catálogo e disponibilidade sem acessar banco logístico.
- [ ] Requisição aprovada cria uma única ordem mesmo após repetição da chamada.
- [ ] Reserva parcial e falta são devolvidas item a item.
- [ ] Progresso físico aparece no Axis por eventos idempotentes.
- [ ] Falha de comunicação entra em retentativa e é visível para suporte.
- [ ] Reconciliação detecta requisição, reserva ou movimento divergente.

### 22.3 Estoque

- [ ] Nenhum saldo é alterado sem movimento.
- [ ] Movimento confirmado só é corrigido por reversão vinculada.
- [ ] Disponível exclui reserva, bloqueio, quarentena e vencido.
- [ ] Estoque negativo é impedido.
- [ ] Lote, série, condição e propriedade são preservados em toda transferência.
- [ ] Operações concorrentes não permitem dupla reserva/saída.

### 22.4 Operação

- [ ] Recebimento associa pedido Axis e registra divergências.
- [ ] Picking valida endereço, item, lote/série e quantidade.
- [ ] FEFO é respeitado para validade ou exige exceção autorizada.
- [ ] Entrega identifica recebedor e produz comprovante.
- [ ] Devolução passa por classificação antes de voltar ao disponível.
- [ ] Transferência mantém estoque em trânsito até aceite do destino.

### 22.5 Inventário e controle

- [ ] Contagem cega e recontagem funcionam conforme tolerância.
- [ ] Ajuste relevante depende de aprovação do Axis.
- [ ] Auditoria reconstrói saldo a partir do ledger.
- [ ] Exportações e relatórios respeitam empresa e almoxarifado.
- [ ] Usuário sem escopo não acessa saldo, custo, documento ou operação por URL/API.

### 22.6 Mobile/offline

- [ ] Leitura de código funciona em dispositivos homologados.
- [ ] Repetição após perda de conexão não duplica movimento.
- [ ] Conflito é apresentado ao operador e não sobrescrito silenciosamente.
- [ ] Dados locais são protegidos e removidos após sincronização/política.

## 23. Cenários de teste obrigatórios

1. Duas requisições disputam o último saldo simultaneamente.
2. Axis repete o mesmo comando após timeout.
3. Item solicitado fica bloqueado depois da reserva.
4. Separação por FEFO com lotes em endereços diferentes.
5. Série duplicada no recebimento.
6. Recebimento parcial, excedente e item diferente do pedido.
7. Conversão caixa → unidade com fator versionado.
8. Cancelamento antes da reserva, durante picking e após expedição.
9. Entrega parcial e recusa pelo recebedor.
10. Transferência expedida, divergente e não recebida no prazo.
11. Devolução de ferramenta avariada com manutenção.
12. EPI por tamanho, CA e lote entregue ao colaborador.
13. Desligamento com ativos e ferramentas pendentes.
14. Inventário durante tentativa concorrente de movimentação.
15. Ajuste acima da tolerância sem e com aprovação Axis.
16. Operação offline repetida e conflito ao sincronizar.
17. Evento fora de ordem e webhook com assinatura inválida.
18. Falha do Axis após movimento confirmado e reconciliação posterior.
19. Material de terceiro separado de estoque próprio.
20. Lote vencido, próximo do vencimento e validade insuficiente no recebimento.

## 24. Plano de implementação

### Fase 0 — Descoberta e saneamento

- mapear almoxarifados, endereços, materiais, planilhas e saldos;
- validar catálogo inicial, unidades, lotes, séries, CAs e patrimônio;
- definir donos de dados e sistema mestre;
- definir APIs, autenticação, ambientes e contratos de eventos;
- fazer inventário físico de abertura e plano de migração.

### Fase 1 — Fundação e integração

- catálogo, almoxarifados, endereços, ledger e saldos;
- sincronização de mestres do Axis;
- consulta de catálogo/disponibilidade no Axis;
- requisição aprovada, reserva, picking, entrega e retorno de status;
- aplicativo de leitura e etiquetas;
- auditoria e dashboards básicos.

### Fase 2 — Entradas e mobilidade logística

- pedidos, recebimento, inspeção e armazenagem;
- transferências, expedição, volumes, romaneios e comprovantes;
- devoluções, custódia, ferramentas, EPIs e patrimônio;
- offline controlado.

### Fase 3 — Controle avançado

- inventário rotativo, reposição, ABC/XYZ e previsão;
- validade, calibração, químicos e certificados;
- integrações financeiras/patrimoniais ampliadas;
- indicadores, alertas e reconciliação automatizada.

## 25. Migração e entrada em produção

1. consolidar e deduplicar catálogo legado;
2. definir códigos e conversões de UM;
3. etiquetar endereços e itens rastreáveis;
4. importar lotes, séries, validades e custodiante;
5. realizar contagem física de corte;
6. importar saldo inicial como documento auditável;
7. reconciliar valores com Axis/Financeiro;
8. bloquear planilhas paralelas após estabilização;
9. executar piloto em um almoxarifado e grupo de projetos;
10. ampliar por ondas com suporte e indicadores.

## 26. Definition of Done

Uma funcionalidade só está concluída quando:

- regra de estoque, autorização e validação existem no backend;
- operação gera movimento e auditoria consistentes;
- integração é idempotente, observável e possui tratamento de falha;
- interface web/móvel trata loading, vazio, erro, offline e conflito;
- formatos pt-BR, unidades e precisão estão corretos;
- testes unitários, integração, concorrência e autorização passaram;
- documentação de API/evento e migração foi atualizada;
- não há IDs, usuários, almoxarifados, códigos ou aprovações fixos no código;
- o Axis e o sistema logístico continuam com responsabilidades claramente separadas.

## 27. Prompt operacional para a IA de desenvolvimento

Use este documento como requisito funcional e técnico. Antes de implementar:

1. inspecione a arquitetura e os cadastros existentes do Axis;
2. confirme qual sistema é mestre para cada entidade;
3. implemente por fluxo vertical: banco, regra, API, integração, UI, auditoria e testes;
4. use ledger imutável para movimentos e controle transacional contra dupla saída;
5. trate comandos e eventos como idempotentes;
6. nunca compartilhe banco entre Axis e Logística;
7. não prometa disponibilidade antes de confirmar reserva;
8. não altere saldo diretamente nem esconda divergências;
9. aplique automaticamente pt-BR, BRL, fuso, acessibilidade, segurança e responsividade;
10. preserve dados existentes e só declare conclusão depois de testar cenários normais, falhas e concorrência.

## 28. Decisões que a LGC deve validar

- relação oficial de unidades e almoxarifados;
- materiais realmente utilizados, marcas homologadas e SKUs;
- itens controlados por lote, validade, série, CA, calibração e patrimônio;
- políticas de estoque mínimo, reserva e substituição;
- tolerâncias de recebimento e inventário;
- regras de entrega parcial e expiração de reserva;
- fluxos de produtos químicos, resíduos e itens perigosos;
- transportadoras, rotas e necessidade de geolocalização;
- dispositivos, impressoras e padrão de etiquetas;
- custos que podem ser exibidos à operação;
- alçadas para ajustes, perdas, baixa e descarte;
- níveis de serviço por unidade/projeto;
- política de modo offline;
- sistema responsável pelo patrimônio contábil.

Essas definições são parâmetros de implantação. A arquitetura, o catálogo versionado, o ledger, a integração idempotente e os fluxos básicos podem ser desenvolvidos desde a primeira fase.
