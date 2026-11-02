# Decisões e lote de questões de negócio

Nenhuma resposta nova foi obtida nesta etapa. “Recomendação” abaixo é proposta de homologação, não aprovação presumida do usuário. Escolhas técnicas de motor, tabelas, comandos, versão e isolamento do piloto foram fechadas nos demais documentos.

## Decisões explícitas preservadas

| ID | Origem | Efeito no projeto |
|---|---|---|
| U01 | Instrução atual: nada em produção, pode substituir Requisições | Construir motor novo isolado, sem projeto de remendo integral do legado; não apagar dados |
| U02 | Instrução atual: preservar autenticação, cadastros e outros módulos | Reusar stack/identidade/cadastros; nenhuma refatoração global de auth ou telas de cadastro |
| U03 | `REQUISICOES_SPEC.md` §27.1, decisão registrada em 01/11/2026 | BYTEA no PostgreSQL, sem antimalware real por ora. Manter validação básica e limites; não incluir S3/MinIO/ClamAV neste ciclo |
| U04 | `REQUISICOES_SPEC.md` §27.2, decisão registrada em 01/11/2026 | Pular nível hierárquico ausente, inclusive aprovação automática no topo vazio. Regra explícita/versionada/auditada; não confundir com falha de configuração |
| U05 | Coordenação dos chats | Sol planeja/revisa; Luna implementa um pacote por vez. Não iniciar implementação nesta etapa |

## Lote para homologação antes das entregas dependentes

Estas são as decisões realmente impeditivas para habilitar os processos específicos, agrupadas para uma única rodada com o responsável de negócio. Não bloqueiam a escrita do motor nem P01 interno. Se não houver resposta, manter processos afetados desabilitados operacionalmente e continuar o trabalho independente; tempo decorrido não é aceite.

| ID / decisão | Recomendação concreta | Alternativa / impacto | Gate |
|---|---|---|---|
| B01 — Cadeia e momento da aprovação de compra | Responsável independente do CC aprova necessidade antes da reserva; escolhe proposta para saldo; matriz financeira do §9.2 em snapshot aprova gasto antes de emitir pedido | Só aprovar depois da cotação elimina aprovação pré-reserva, mas precisa autorização explícita para reserva de material sem gestor. Seeds atuais divergem da matriz da spec; não importá-los como regra final | Antes de habilitar piloto P07; P04 pode usar fixture documentada |
| B02 — Estoque parcial e entrega | Manter reserva/entrega parcial autorizada e comprar saldo; concluir somente após entrega total ou dispensa formal do gestor; aceite do solicitante obrigatório | Esperar compra do saldo para entrega única aumenta espera e reserva; exige outra configuração/logística. Confirmar se a área permite entrega parcial e quem dispensa saldo | Antes de homologar jornada parcial de P07 |
| B03 — Donos e pessoas reais das filas/alçadas | Dono de processo indica membros/gestores de Suprimentos/Almoxarifado/Financeiro e responsáveis independentes; preencher pela UI usando cadastros existentes | Não inventar usuário ou grupo “Conselho”; ausência fica incidente. Confirmar competência Financeiro/Diretoria e matriz de valores | Antes de publicar processo de compra para usuários reais |
| B04 — Cancelamento após efeito físico/pedido | Gestor solicita; Logística confirma liberação/devolução ou recusa com impacto; Core mantém pendência até compensar; não encerrar por timeout | Cancelar somente administrativamente quebraria conciliação de estoque/pedido. Se existir custo não reversível, exigir aceite de impacto por gestor | Antes de habilitar cancelamento pós-efeito P07 |
| B05 — Processos restritos, identidade e retenção | Manter categorias restritas no legado até definir grupo independente, campos por papel, acesso à identidade, retenção e homologar negativas em todas as superfícies | Abrir templates genéricos a RH/denúncia sem grupo homologado não tem aceite. Não definir prazo legal ou retenção arbitrária | Bloqueia somente expansão restrita P09 |

## Defaults de homologação declarados, não impeditivos para P01

- Organização única; sem empresa/unidade fictícia. Escopo por processo/fila/registro.
- P01 somente processo interno simples, não financeiro e sem autoaprovação/aceite obrigatório; close manual. A mesma pessoa pode modelar e publicar se tiver ambas as permissões/grants.
- Expediente inicial seg–sex 08–18 em America/Sao_Paulo; feriados copiados na publicação. Metas de teste 240/2.880 minutos, com rótulo correto. Não prometer atendimento P1 24h sem plantão configurado.
- Para P05: solução desde envio; primeira resposta humana; espera do autor pausa solução por até cinco dias úteis; auto-close em três dias úteis somente quando não exige aceite; reabertura em cinco dias úteis. São defaults configuráveis derivados da spec, a serem homologados pelo dono antes de publicar processo com contrato de SLA real.
- Representação desabilitada por padrão; ativação exige permissão específica, justificativa e política do processo.
- Aprovação tem veto por qualquer rejeição; aprovação financeira alterada reinicia a rodada inteira. Quórum sem pessoa suficiente gera incidente; única exceção é a hierarquia vazia explicitamente configurada por U04.
- Uma cotação válida mínima no piloto; exigir três ou regra de fornecedor homologado fica como parametrização do processo, não condição técnica inventada.

## Resposta esperada do responsável de negócio

Uma resposta em lote pode indicar `B01/B02/B04: recomendação aceita`, ajustes de matriz/fluxo e responsáveis para B03; B05 pode ficar para onda posterior. Registrar resposta com autor/data/fonte neste arquivo, atualizar snapshots de teste e critérios dos pacotes afetados. Não alterar decisões históricas U03/U04 silenciosamente.
