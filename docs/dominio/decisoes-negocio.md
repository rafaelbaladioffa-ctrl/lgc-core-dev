# Requisições — registro de decisões de negócio

> **Propósito:** registro único das decisões de negócio que afetam o módulo Requisições, separando o que está decidido do que está pendente, para que a reescrita do motor não decida por conta própria nem reabra o que já foi decidido.
> **Data:** 2026-11-07.
> **Fontes:** [08-decisoes-negocio.md](../arquivo/bpm-2026-11/08-decisoes-negocio.md) (U01–U05, B01–B05, defaults), [requisicoes-spec.md §26 e §27](requisicoes-spec.md#26-parâmetros-que-a-lgc-deve-validar-antes-da-produção), [planning-v0.2.md §8](../arquivo/planning-v0.2.md#8-pontos-abertos--decisões-tomadas-nesta-sessão), histórico git.

**Regras do registro.** Uma decisão nova recebe ID novo; IDs não são reaproveitados. Mudar uma decisão exige nova linha que a substitui, com autor, data e fonte — a linha antiga fica marcada "substituída". Recomendação não é decisão: sem resposta do responsável de negócio, o item permanece pendente e o processo afetado fica desabilitado para uso operacional.

---

## 1. Decididas

| ID | Decisão | Status | Data | Origem |
|---|---|---|---|---|
| U01 | Nada de Requisições está em produção; o módulo pode ser substituído. Construir motor novo isolado em vez de remendar o legado integralmente, sem apagar dados. | decidida | não datada na fonte (ciclo BPM aberto em 2026-11-01) | [08 U01](../arquivo/bpm-2026-11/08-decisoes-negocio.md) — instrução do usuário |
| U02 | Preservar autenticação, cadastros e demais módulos: reusar stack, identidade e cadastros; nenhuma refatoração global de auth ou telas de cadastro. | decidida | idem U01 | [08 U02](../arquivo/bpm-2026-11/08-decisoes-negocio.md) — instrução do usuário |
| U03 | Anexos em `BYTEA` no PostgreSQL, sem antimalware real por ora; manter validação de MIME por magic bytes, bloqueio de executáveis e limites (25 MB/arquivo, 100 MB/requisição). Sem S3/MinIO/ClamAV neste ciclo. Revisitar antes de produção real com dados sensíveis ou arquivos grandes. | decidida (temporária, com revisão obrigatória) | 2026-11-01 | [spec §27.1](requisicoes-spec.md#271-armazenamento-de-anexos-seguros--decisão-consciente-revisitar-antes-de-produção-real); [08 U03](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| U04 | Nível hierárquico ausente é pulado, inclusive com aprovação automática quando a cadeia fica vazia no topo (ex.: diretor/admin sem superior, mesmo em alto valor). Nenhum aprovador de fallback (Conselho/Diretoria) definido. No motor novo: regra explícita, versionada e auditada (`onEmptyHierarchy: "skip_with_audit"`), distinta de falha de configuração (ver RM-AUT-09/10). | decidida | 2026-11-01 | [spec §27.2](requisicoes-spec.md#272-aprovação-automática-sem-aprovador-no-topo-da-hierarquia--mantido-como-está); [08 U04](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| U05 | Coordenação: um agente planeja/revisa, outro implementa um pacote por vez. | decidida (processo de trabalho do ciclo BPM; não é regra de produto) | 2026-11-01 | [08 U05](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| PL-01 | Integração com satélites por **outbox + webhook**, não RabbitMQ. | decidida | 2026-11-01 (não datada na fonte; presente desde o commit `c85e883`) | [planning-v0.2 §8 #1](../arquivo/planning-v0.2.md) |
| PL-02 | SLA e escalonamento de chamados entram no MVP. | decidida | idem PL-01 | [planning-v0.2 §8 #2](../arquivo/planning-v0.2.md) |
| PL-03 | Nome do sistema: **Axis**. | decidida | idem PL-01 | [planning-v0.2 §8 #3](../arquivo/planning-v0.2.md) |
| PL-04 | Sem multi-tenancy: unidade única, sem isolamento por tenant. | decidida | idem PL-01 | [planning-v0.2 §8 #4](../arquivo/planning-v0.2.md) |
| PL-05 | Volume esperado 50–300 usuários/colaboradores; VPS 4 vCPU / 8 GB RAM / 80 GB SSD. | decidida | idem PL-01 | [planning-v0.2 §8 #5](../arquivo/planning-v0.2.md) |
| PL-06 | Retenção de dados sensíveis pós-desligamento: indefinida — sem expurgo automático, apenas soft-offboarding. | decidida (provisória; ver P26-06) | idem PL-01 | [planning-v0.2 §8 #6](../arquivo/planning-v0.2.md) |
| D-01 | Remover o módulo BPM P01–P04 do código para reescrita organizada; o estado anterior fica preservado no checkpoint `629044d`. | decidida | 2026-11-02 | commits `629044d` e `98dfce5` |
| D-02 | Apagar do banco as tabelas, triggers, colunas e permissões do BPM, descartando os dados do piloto P01; categorias do piloto ficam inativas e requisições existentes são mantidas. | decidida | 2026-11-07 | dono do produto, em conversa; migração `20261121000000_remove_bpm` |

## 2. Pendentes

### 2.1 Lote de homologação B01–B05

Não bloqueiam a escrita do motor nem o primeiro processo interno; bloqueiam a habilitação operacional dos processos afetados. "Recomendação" é proposta, não aprovação.

| ID | Decisão | Status | Data | Origem |
|---|---|---|---|---|
| B01 | **Cadeia e momento da aprovação de compra.** Recomendação: responsável independente do CC aprova a necessidade antes da reserva; escolhe a proposta para o saldo; matriz financeira do §9.2 da spec aprova o gasto antes de emitir pedido. Alternativa: aprovar só após a cotação (exige autorização explícita para reservar sem gestor). Os seeds atuais divergem da matriz da spec e não devem ser importados como regra final. | pendente — gate antes do piloto de compras | levantada em 2026-11-01 | [08 B01](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| B02 | **Estoque parcial e entrega.** Recomendação: reserva/entrega parcial autorizada e compra do saldo; concluir só após entrega total ou dispensa formal do gestor; aceite do solicitante obrigatório. Confirmar se a área permite entrega parcial e quem dispensa saldo. | pendente — gate da jornada parcial | 2026-11-01 | [08 B02](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| B03 | **Pessoas reais das filas e alçadas.** Dono do processo indica membros/gestores de Suprimentos, Almoxarifado, Financeiro e responsáveis independentes, preenchidos pela UI. Confirmar competência Financeiro/Diretoria e a matriz de valores. Não inventar usuário nem grupo "Conselho". | pendente — gate antes de publicar compras para usuários reais | 2026-11-01 | [08 B03](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| B04 | **Cancelamento após efeito físico/pedido.** Recomendação: gestor solicita; Logística confirma liberação/devolução ou recusa com impacto; Core mantém pendência até compensar; sem encerramento por timeout. Custo irreversível exige aceite de impacto pelo gestor. | pendente — gate do cancelamento pós-efeito | 2026-11-01 | [08 B04](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |
| B05 | **Processos restritos, identidade e retenção.** Recomendação: manter categorias restritas (RH, denúncia) fora do motor novo até definir grupo independente, campos por papel, acesso à identidade, retenção e homologar negativas em todas as superfícies. Não definir prazo legal arbitrário. | pendente — bloqueia só a expansão restrita | 2026-11-01 | [08 B05](../arquivo/bpm-2026-11/08-decisoes-negocio.md) |

### 2.2 Parâmetros de implantação (spec §26)

| ID | Parâmetro a validar pela LGC | Status | Data | Origem |
|---|---|---|---|---|
| P26-01 | Nomes oficiais de cargos, gestores, empresas e unidades | pendente | não datado | [spec §26](requisicoes-spec.md#26-parâmetros-que-a-lgc-deve-validar-antes-da-produção) |
| P26-02 | Matriz financeira e competência de cada diretor (relaciona-se a B01/B03) | pendente | não datado | idem |
| P26-03 | Calendários, plantões e SLAs contratuais | pendente | não datado | idem |
| P26-04 | Categorias que aceitam abertura em nome de terceiro | pendente | não datado | idem |
| P26-05 | Política de anonimato e investigação de denúncias (relaciona-se a B05) | pendente | não datado | idem |
| P26-06 | Prazos legais, retenção e classificação documental (PL-06 é provisória) | pendente | não datado | idem |
| P26-07 | Sistemas integrados e donos de dados | pendente | não datado | idem |
| P26-08 | Limites e tipos de anexos (U03 fixa os atuais como temporários) | pendente | não datado | idem |
| P26-09 | Categorias restritas e grupos autorizados (relaciona-se a B05) | pendente | não datado | idem |
| P26-10 | Critérios de satisfação e encerramento automático | pendente | não datado | idem |

### 2.3 Defaults propostos para homologação (não decididos)

Declarados em [08](../arquivo/bpm-2026-11/08-decisoes-negocio.md) como defaults de teste, configuráveis; precisam de homologação do dono antes de processo com contrato real.

| ID | Default proposto | Status | Data | Origem |
|---|---|---|---|---|
| H-01 | Organização única; escopo por processo/fila/registro (coerente com PL-04) | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-02 | Primeiro processo: interno simples, não financeiro, sem autoaprovação nem aceite obrigatório, close manual; a mesma pessoa pode modelar e publicar se tiver ambas as permissões | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-03 | Expediente seg–sex 08h–18h `America/Sao_Paulo`, feriados copiados na publicação; metas de teste 240/2.880 min com rótulo correto; sem promessa de atendimento 24 h sem plantão | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-04 | Solução contada desde o envio; primeira resposta humana; espera do autor pausa por até 5 dias úteis; auto-close em 3 dias úteis só sem aceite obrigatório; reabertura em 5 dias úteis | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-05 | Representação (abrir em nome de terceiro) desabilitada por padrão; ativação exige permissão, justificativa e política (relaciona-se a P26-04) | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-06 | Veto por qualquer rejeição; aprovação financeira alterada reinicia a rodada inteira; quórum sem pessoas suficientes gera incidente (exceção única: U04) | pendente de homologação | 2026-11-01 | 08 Defaults |
| H-07 | Mínimo de uma cotação válida no piloto; exigir três ou fornecedor homologado é parametrização do processo | pendente de homologação | 2026-11-01 | 08 Defaults |

## 3. Observações de consistência

- **U04 × falha de configuração.** O código atual aprova automaticamente qualquer cadeia vazia, inclusive quando não há faixa de alçada aplicável ([requests.service.ts:308-310](../../backend/src/requests/requests.service.ts#L308-L310), [:1292-1293](../../backend/src/requests/requests.service.ts#L1292-L1293)). U04 cobre só o topo da hierarquia; matriz sem faixa deve ser incidente (RM-AUT-10). A decisão não precisa mudar, mas a implementação atual vai além dela.
- **Matriz financeira.** A spec §9.2 sugere gestor do CC / gerente / Financeiro / Diretoria; o seed [seed-approval-authority-matrix.ts:36-42](../../backend/prisma/seed-approval-authority-matrix.ts#L36-L42) usa níveis supervisor/coordenador/gerente/diretor, sem Financeiro. Nenhuma das duas está homologada (B01/B03/P26-02).
- **PL-06 × P26-06.** Retenção "indefinida, sem expurgo" foi decidida no planejamento geral, mas a spec de Requisições ainda lista retenção e prazos legais como parâmetros a validar. Tratar PL-06 como provisória até P26-06.
- **Resposta esperada.** Uma resposta em lote pode indicar "B01/B02/B04: recomendação aceita", ajustes de matriz e nomes para B03; B05 pode ficar para onda posterior. Registrar aqui com autor, data e fonte.
