# Axis Financeiro — módulo Projetos (orçamento e resultado)

Primeiro módulo de domínio do satélite Financeiro: **orçar o projeto, medir o lucro previsto e
comparar com o realizado**. Documento de **alvo**: nada daqui está implementado; o estado de cada
entrega fica em [§16](#16-entregas).

Redigido em 2026-11-07 a partir da planilha que a LGC usa hoje para cotar projetos do cliente AWS
(*Calculadora SOW AWS v5*: abas Calculadora, Custos e Lucro, Parâmetros e leitura da SOW), da
[especificação do Financeiro](especificacao.md) e do cadastro de projetos do Core
([cadastros.md §10](../../docs/dominio/cadastros.md#10-projetos)).

> **Repositório público.** Este documento descreve parâmetros e fórmulas, **nunca valores**:
> salários, custo hora, valor hora cobrado, custo de material, metas e catálogos de cliente, textos de
> SOW e dados de sites ficam só no banco (cadastrados pela tela de Parâmetros) ou em arquivos fora do
> Git. Testes usam valores fictícios.

## 0. Resumo

| Item | Decisão |
|---|---|
| Prioridade | Projetos é o primeiro módulo do Financeiro; contas a pagar (F1–F6 da [especificação](especificacao.md)) vem depois. Ver P-01 |
| Onde mora | Satélite Financeiro (`lgc-dev-financeiro/`), banco `axis_financeiro` |
| Projeto | O do Core (`PROP-…`), lido do cache `axis_master_cache`. O Financeiro não cria nem edita projeto |
| O que o módulo guarda | Parâmetros de custo versionados, catálogos (material, destinos), orçamentos com revisões, dados da SOW, apontamentos e custos realizados |
| Cálculo | No servidor, com `Prisma.Decimal`. O frontend pede simulação à API; nunca calcula dinheiro sozinho |
| Modelos de orçamento | `generico` (qualquer obra) e `aws_sow` (genérico + leitura da SOW, horas-meta, indicadores e valores do Bid Template) |
| Resultado-chave | Lucro real depois de impostos e **lucro sobre o custo** contra a meta da empresa |
| Fluxo com o Core | O Core pede a cotação ("Solicitar cotação", com a SOW em PDF); o Financeiro devolve, por revisão aprovada para envio, a Bid preenchida e a equipe orçada (§13.1, P-11 a P-15) |

## 1. Da planilha para o sistema

| Aba da planilha | Vira no sistema |
|---|---|
| Parâmetros | Conjunto de parâmetros **versionado** (§4) + catálogo de materiais + tabela de destinos |
| SOW (colar aqui) | Importação da SOW no modelo `aws_sow` (§7.1) |
| Calculadora §1–§2 | Cabeçalho do orçamento e linhas de cabo do modelo AWS (§7) |
| Calculadora §3–§6 | Composição do orçamento: equipe, material, condições gerais, total da proposta (§5) |
| Calculadora §7–§8 | Indicadores da AWS e valores para o Bid Template (§7.3–§7.4) |
| Custos e Lucro §1–§11 | Custo previsto, indiretos, resultado, preço mínimo e preço da meta (§6) |
| Custos e Lucro §12 | Realizado: apontamentos e custos lançados (§8) |

O que muda em relação à planilha está em [§15](#15-diferenças-intencionais-em-relação-à-planilha).

## 2. Conceitos

- **Projeto**: registro do Core (`code`, nome, cliente, centro de custo, responsável, status, início e
  conclusão previstos). O Financeiro guarda uma cópia no cache de mestres (webhook `project.*` e
  "Atualizar do Axis Core"). Projetos criados no Core antes de 2026-11-07 podem estar sem nome. O
  valor do projeto continua só no orçamento (P-07, resolvida).
- **Orçamento** (`project_budgets`): um por projeto e modelo. Tem revisões.
- **Revisão** (`budget_revisions`): versão numerada (R1, R2…) com as entradas, o conjunto de
  parâmetros usado e o resultado calculado. Só a revisão `rascunho` é editável.
- **Conjunto de parâmetros** (`parameter_sets`): valores de custo, impostos e metas vigentes a partir
  de uma data. Publicado, fica imutável; mudar um valor gera nova versão. Cada revisão aponta para o
  conjunto que usou, então um orçamento antigo não muda quando o salário ou o imposto mudam.
- **Cobrado × custo**: toda linha do orçamento tem o valor **cobrado do cliente** (receita) e o
  **custo real da LGC**. A diferença por grupo mostra onde está o lucro.
- **Realizado**: o que de fato aconteceu na obra (equipe, dias, carros, custos), comparado com a
  revisão aprovada.

## 3. Ciclo de vida

### 3.1 Revisão

```
rascunho ──submeter──▶ em_aprovacao ──aprovar envio──▶ enviada ──cliente aceitou──▶ ganha
   ▲                      │                              │
   └────── devolver ──────┘                              ├──cliente recusou──▶ perdida
                                                         └──nova revisão─────▶ substituida
```

- Nova revisão nasce copiando a última (entradas e conjunto de parâmetros, que pode ser trocado pelo
  vigente). A anterior, se `enviada`, vira `substituida` quando a nova é enviada.
- **Nada é enviado ao cliente sem aprovação** (regra da planilha): `aprovar envio` exige
  `budget:approve`. Ver P-03.
- `ganha` congela a revisão como **linha de base** do realizado. Só uma revisão por orçamento pode
  estar `ganha`.
- **`ganha` tem efeito (PT-07, PA-13):** na mesma transação, a receita contratada e os custos orçados viram
  lançamentos `comprometido` no centro de custo do projeto ([§8](#8-realizado)). Isso vale para as duas
  entradas, que passam pelo mesmo código e não duplicam: a ação manual "Cliente aceitou" e o evento
  `project.approved` do Core ([§13.2](#132-projeto-aprovado-no-core-ganha-sozinha)).
- Revisões nunca são apagadas; rascunho abandonado pode ser `descartado`.
- **Quem faz cada passo:** submeter e descartar exigem `budget:write`; devolver, aprovar envio, ganha e
  perdida exigem `budget:approve`. Devolver e perder pedem motivo. A API devolve em cada revisão as
  ações que o usuário pode fazer agora (`workflow.allowedActions`) e o que impede submeter
  (`submitBlockers`: dias de trabalho, equipe de campo e valor da proposta).
- **Nova revisão** só sem rascunho, sem revisão em aprovação e antes de haver uma `ganha`.
- **Histórico:** cada passo grava `budget_revision_events` (ação, de → para, motivo, quem e quando;
  append-only) e auditoria com antes/depois. Aprovar o envio guarda quem aprovou e quando (vai para o
  Core na PJ7) e registra `selfApproved` quando quem aprova é quem submeteu (P-03).

### 3.2 Relação com o status do Core

O Core é dono do status do projeto (`proposta → aprovado → em_execucao → encerrado`). O Financeiro
**não altera** o status do Core; só avisa divergências na tela:

| Situação | Aviso |
|---|---|
| Projeto `aprovado`/`em_execucao` no Core sem revisão `ganha` | "Projeto aprovado sem orçamento ganho" |
| Revisão `ganha` com projeto ainda `proposta` no Core | "Atualize o status do projeto no Core" |
| Projeto `encerrado` no Core com realizado aberto | "Feche o realizado" |

A devolução da cotação aprovada para envio ao Core está em §13.1. Quando o comercial aprova o projeto
no Core, o Core avisa (`project.approved`) e a revisão aceita vira `ganha` sozinha (§13.2). Emitir
`budget.won` para o Core fica para quando ele tiver receptor genérico de eventos de satélite.

**Alertas no orçamento.** O que o Financeiro não decide sozinho vira alerta aberto na página do projeto
(`budget_alerts`; `budget:approve` dispensa com `POST /budgets/:id/alerts/:alertId/dismiss`, com auditoria):
revisão aprovada no Core enquanto outra já está `ganha` no mesmo orçamento (nada é sobrescrito), revisão que
não estava `enviada`, projeto sem centro de custo no Financeiro (a revisão ganha, mas o comprometido não é
lançado) e comprometido que não foi lançado porque outro orçamento do mesmo projeto já é a linha de base.

## 4. Parâmetros (versionados)

Conjunto `PAR-NNNN`, estados `rascunho → vigente → arquivado`. Só um `vigente` por vez; publicar
um novo arquiva o anterior. Toda leitura e alteração é auditada (há salário).

### 4.1 Funções da equipe

Uma linha por função (inicialmente `tecnico`, `encarregado`, `gerente_projeto`; outras podem ser
cadastradas):

| Campo | Uso |
|---|---|
| `billing_rate` | Valor hora cobrado do cliente (margem embutida) |
| `monthly_salary` | Salário bruto da carteira |
| `plr_salaries_per_year` | PLR em nº de salários (sem INSS/FGTS) |
| `meal_per_worked_day` | Vale-refeição por dia trabalhado |
| `transport_per_month` | Vale-transporte, pago 11 meses |
| `gym_per_month`, `health_per_month`, `other_benefits_per_month` | Pagos 12 meses |
| `cost_per_hour_override` | Custo hora informado direto (ex.: gerente terceirizado); quando preenchido, substitui o cálculo |
| `field_role` | Se entra nas "horas de campo" (técnico e encarregado sim; gerente não) |

### 4.2 Gerais

| Grupo | Parâmetros |
|---|---|
| Jornada | horas por dia; dias úteis no ano; dias úteis de férias |
| Encargos | INSS patronal; RAT × FAP; terceiros; FGTS; provisão de multa do FGTS (% do FGTS); desconta 6% no VT (sim/não) |
| Impostos (lucro presumido) | PIS; COFINS; ISS; presunção IRPJ; IRPJ; adicional de IRPJ aplica (sim/não); presunção CSLL; CSLL |
| Veículo | R$/km cobrado; consumo (km/l); preço do combustível; desgaste (R$/km) |
| Material | markup sobre material; sobra de RJ45 (%) |
| Plataforma | locação mensal; dias de uso por mês; frete/mobilização; diária cobrada padrão |
| Indiretos e meta | contingência (% dos diretos); rateio de despesas fixas (% da receita); comissão (% da receita); prazo de recebimento (dias); custo do dinheiro (% ao mês); **meta de lucro sobre o custo** |

### 4.3 Catálogos (não versionados; o orçamento copia o valor na hora de usar)

- **Materiais** (`budget_materials`): nome, fabricante, código, unidade, preço cobrado, custo real,
  referência no formulário do cliente (ex.: linha do Bid Template), ativo. Ver P-06.
- **Destinos** (`budget_destinations`): nome, km ida e volta a partir da sede, pedágio por dia
  ida e volta, rota/fonte, ativo.

## 5. Composição do orçamento (entradas)

Cada revisão guarda as entradas abaixo; o servidor gera as linhas calculadas (§6). Quantidades
`NUMERIC(14,4)`; dinheiro `NUMERIC(14,2)`.

| Seção | Entradas |
|---|---|
| Cabeçalho | Projeto do Core (obrigatório), título, início e conclusão previstos (do orçamento, não da revisão: ver abaixo), observações (da revisão) |
| Equipe | Por função: pessoas e dias (funções de campo) ou horas (gerente) |
| Material | Item do catálogo ou avulso (descrição, preço cobrado, custo real), quantidade; frete/retirada; perdas (% do custo) |
| Deslocamento | Destino do catálogo ou km/pedágio manuais; carros; aluguel de carro e estacionamento por carro/dia (custo). Diárias de veículo = carros × dias de trabalho |
| Plataforma | Dias; diária cobrada; custo real opcional (substitui o cálculo) |
| Hospedagem e alimentação | Pessoas × noites × valor; pessoas × dias × valor; custo real opcional |
| Mão de obra extra (custo, não cobrada) | Horas extras/fim de semana previstas (R$); credenciamento e integração do cliente (R$) |
| Outros custos (não cobrados) | EPI e uniformes; ferramentas e equipamentos; seguro e ART; outros com descrição |

"Dias de trabalho" é um número da revisão, comum a todas as funções de campo (como na planilha).
Equipes com dias diferentes por função ficam para depois.

**Cabeçalho e dados do Core (P-07, decidido em 2026-11-07).** O cabeçalho pertence ao orçamento e vale
para todas as revisões; não entra no cálculo e pode ser alterado em qualquer situação da revisão
(`PATCH /budgets/:id`, `budget:write`, com auditoria `budget.updated`).

- **Título**: opcional. Vazio, o orçamento mostra o nome do projeto no Core e acompanha a edição lá;
  sem nome no Core (projeto antigo), mostra "código — cliente". Preenchido, o título do orçamento
  prevalece. Na migração, títulos gerados automaticamente (`<código>` ou `<código> — <cliente>`)
  foram esvaziados para passar a seguir o nome do Core.
- **Início e conclusão previstos**: o padrão é o prazo previsto do projeto no Core. Cada data pode ser
  sobrescrita no orçamento (ex.: proposta com prazo diferente do cadastrado); apagar volta a usar a do
  Core. A tela indica a origem de cada data ("do Axis Core" ou "do orçamento"). A conclusão efetiva não
  pode ser antes do início efetivo (`400`); no banco, um `CHECK` vale para as datas próprias.
- O Financeiro não escreve no Core: mudar o prazo do projeto continua sendo feito lá.

## 6. Regras de cálculo

Arredondamento meio-para-cima em 2 casas **só no total de cada linha**; custo hora com 4 casas.
`N(x)` = 0 quando vazio.

### 6.1 Custo hora do colaborador CLT (por função)

```
dias_trab      = dias_úteis_ano − dias_férias
horas_ano      = dias_trab × horas_dia
base_folha     = 12 × salário + salário (13º) + salário / 3 (1/3 de férias)
encargos       = base_folha × (INSS + RAT + terceiros)
fgts           = base_folha × FGTS × (1 + provisão_multa)
plr            = salário × plr_salários
vr             = vale_refeição × dias_trab
vt             = max(0, 11 × (vale_transporte − (desconta_6% ? 0,06 × salário : 0)))
fixos          = 12 × (wellhub + saúde + outros_benefícios)
custo_anual    = 12 × salário + 13º + 1/3 + encargos + fgts + plr + vr + vt + fixos
custo_hora     = custo_override ?? custo_anual / horas_ano
```

A tela de Parâmetros mostra também o markup da hora: `billing_rate / custo_hora − 1`.

### 6.2 Receita (valor da proposta)

```
horas(função)      = pessoas × dias × horas_dia        (gerente: horas informadas)
MO_cobrada         = Σ horas(função) × billing_rate(função)
material_cobrado   = Σ qtd × preço_cobrado × (1 + markup_material)
diárias_veículo    = carros × dias
carro_dia          = km_ida_volta × R$/km + pedágio_dia
deslocamento_cobr  = diárias_veículo × carro_dia
plataforma_cobr    = dias_plataforma × diária_cobrada
hosp_alim_cobr     = pessoas×noites×valor + pessoas×dias×valor
RECEITA            = MO_cobrada + material_cobrado + deslocamento_cobr + plataforma_cobr + hosp_alim_cobr
```

### 6.3 Impostos sobre a nota

```
alíquota = PIS + COFINS + ISS + presunção_IRPJ × (IRPJ + (adicional ? 10% : 0)) + presunção_CSLL × CSLL
impostos = RECEITA × alíquota
```

O adicional de IRPJ aplicado sobre toda a presunção é a simplificação conservadora da planilha
(P-09). CBS/IBS de teste não entram como custo.

### 6.4 Custos diretos

```
MO        = Σ horas(função) × custo_hora(função) + horas_extras + credenciamento
material  = Σ qtd × custo_real + frete + perdas% × Σ qtd × custo_real
km_total  = diárias_veículo × km_ida_volta
desloc    = km_total / consumo × combustível + diárias_veículo × pedágio_dia
            + km_total × desgaste + diárias_veículo × (aluguel_carro + estacionamento)
plataforma= (custo_real_informado ?? dias_plataforma × (locação_mensal / dias_uso_mês)) + frete_plataforma
hosp_alim = custo_real_informado ?? valor cobrado
outros    = EPI + ferramentas + seguro_ART + outros
DIRETOS   = MO + material + desloc + plataforma + hosp_alim + outros
```

Material sem custo real cadastrado usa o preço cobrado, **mas a linha e o resultado ficam marcados
como "custo estimado"** (na planilha isso era silencioso).

### 6.5 Indiretos e resultado

```
contingência   = DIRETOS × contingência%
rateio         = RECEITA × rateio%
comissão       = RECEITA × comissão%
custo_fin      = DIRETOS × custo_dinheiro%_mês × prazo_recebimento / 30
INDIRETOS      = contingência + rateio + comissão + custo_fin

margem_contrib = RECEITA − impostos − DIRETOS
LUCRO_REAL     = margem_contrib − INDIRETOS
CUSTO_TOTAL    = DIRETOS + INDIRETOS
LUCRO_S_CUSTO  = LUCRO_REAL / CUSTO_TOTAL            (meta: parâmetro; 100% = lucro igual ao gasto)
margem_real    = LUCRO_REAL / RECEITA
lucro_dia      = LUCRO_REAL / dias ;  lucro_hora_campo = LUCRO_REAL / horas_de_campo
```

Situação: `PREJUÍZO` (lucro < 0), `ABAIXO DA META`, `META ATINGIDA`.

### 6.6 Preço mínimo, preço da meta e valor hora necessário

Com `K = DIRETOS + contingência + custo_fin`, `t` = alíquota, `r` = rateio%, `c` = comissão%,
`m` = meta:

```
preço_mínimo   = K / (1 − t − r − c)                        (lucro zero)
preço_meta     = (1 + m) × K / (1 − t − (1 + m) × (r + c))  (lucro = m × custo total)
falta          = preço_meta − RECEITA
hora_meta(f)   = billing_rate(f) × (MO_cobrada + falta) / MO_cobrada
```

Se um denominador for ≤ 0, o valor fica "inviável com estes percentuais". O `hora_meta` mantém
material e deslocamento e ajusta só as horas, como a planilha.

### 6.7 Cobrado × custo por grupo

Mão de obra; material; deslocamento + plataforma + hospedagem/alimentação; outros (só custo).
Para cada grupo: cobrado, custo, resultado, lucro sobre o custo. Deslocamento negativo = R$/km
cobrado abaixo do custo real.

## 7. Modelo `aws_sow`

Estende o genérico. Constantes do cliente (pesos das horas-meta, metas de horas por metro e por
porta, eficiência mínima, custo por porta, tolerâncias, tabela tipo de cabo → linha do Bid Template)
ficam num **perfil de cliente** versionado junto com os parâmetros, nunca no código.

### 7.1 Importação da SOW

- A SOW vem do Core: é o PDF anexado ao projeto (P-13), versão indicada no `project.quote_requested`.
  O Financeiro baixa o arquivo pela API de integração e extrai o texto no servidor. Colar o texto
  continua possível como alternativa (PDF escaneado ou ilegível).
- **Extração (conferida em 2026-11-08 com duas SOWs reais, fora do Git).** O PDF tem texto (não
  precisa OCR). Extrair com `pdfjs-dist` agrupando os trechos por linha (coordenada y) e descartar o
  rodapé de confidencialidade repetido em toda página; listas continuam entre páginas.
- **Cabeçalho:** rótulos estáveis (`FBN:`, `Project Site(s):`, `Project Name:`, `SPS Project ID:`,
  `SOW UID:`, `Project Type:`), cronograma numerado de 1 a 5 (visita técnica, prazo de envio com hora,
  emissão do PO, início e conclusão do cabeamento) e e-mails dos contatos. Plataforma: frase sobre
  MEWP (ex.: "is not required") ou ausência dela (= não mencionada).
- **Racks e live:** dois formatos — linhas `<host> -- <local> -- Live|Not live, In scope` agrupadas
  por `== Grupo ==`, ou tabela `Devices <host> <local> Live|Not Live`. Conta racks/dispositivos e
  marca "exige janela" quando houver `Live`.
- **Cabos:** dois formatos, e o parser aceita os dois:
  1. Tabela de resumo `Cable Types: Type Length Quantity` (ex.: `8F MPO-MPO 20m 12`). Quando existe,
     é a fonte das quantidades.
  2. Só linhas de conexão: `--- <n>x <tipo> (<m>m) from <A> to <B> [(Path A|B)]`, agrupadas por
     `== Rack ==` e `- Management|Console|Uplink`, ou `<n>x <tipo> <A> <> <B> - <m>m [Route A|B]`. O
     parser soma por tipo e comprimento.

  Tipos: fibra `<n>F <conector>-<conector>` (LC-LC, MPO-LC, MPO-MPO; `MPO-4LC` e `4LC-MPO` são o
  mesmo cabo e a normalização junta os dois) e cobre `Cat6 <cor>`. Endereços com erro de digitação
  (ex.: ponto duplicado) não afetam a contagem e não são validados.
- O servidor extrai: FBN, SOW UID, site, nome do projeto, início e conclusão da execução, prazo de
  envio (UTC, exibido também em Brasília), visita técnica, contatos, racks *live* (exige janela),
  plataforma elevatória (pedida / não precisa / não mencionada) e as linhas de cabo
  (quantidade × tipo, comprimento, fibras).
- A tela mostra **linha a linha** o que foi lido e o total de cabos, para conferência contra a SOW.
  Todo campo pode ser corrigido; a correção fica registrada.
- Linhas manuais para cabo que a SOW não listou no formato padrão.
- O parser é testado com SOWs fictícias no formato real (as reais são do cliente e não entram no
  repositório). O texto original é guardado ou não conforme P-05.

### 7.2 Horas-meta e equipe

```
por tipo de cabo:
  comprimento_médio  = round(metros_SOW / qtd)
  metros_considerados= qtd × comprimento_médio
  portas             = qtd × fibras / 2              (cobre: fibras = 0)
  horas_meta         = peso_m × metros_considerados × meta_h_metro + peso_p × portas × meta_h_porta
horas_de_campo       = Σ funções de campo: pessoas × dias × horas_dia
dias_sugeridos       = ceil(Σ horas_meta / (pessoas_de_campo × horas_dia))
cabe_na_janela       = dias ≤ dias úteis entre início e conclusão (calendário de feriados do Core)
horas_T(tipo)        = round(horas_de_campo × horas_meta(tipo) / Σ horas_meta); a diferença de
                       arredondamento vai para a primeira linha; pode ser sobrescrita à mão
```

A soma das horas T tem de ser igual às horas de campo; se não for, a revisão não pode ser submetida.

Sugestões: RJ45 = `ceil(cabos de cobre × 2 × (1 + sobra))`; limpador MPO quando houver cabo MPO.
Cabos fornecidos pelo cliente entram **só como instalação** (nunca em material).

### 7.3 Indicadores do cliente (prévia da aba *Bid KPIs*)

| Indicador | Cotação | Precisa "Yes" + justificativa quando |
|---|---|---|
| Eficiência | horas-meta do modelo / horas de mão de obra da Bid | abaixo da eficiência mínima |
| Custo por porta | RECEITA / portas | mais de 10% acima da meta |
| Mão de obra por porta | MO_cobrada / portas | sempre (meta do cliente inconsistente; configurável) |
| Horas por porta | horas_de_campo / portas | acima da meta + tolerância |
| Horas por metro | horas_de_campo / metros_considerados | acima da meta + tolerância |

Cada "Yes" pede um texto de justificativa (em inglês) guardado na revisão.

**O que o Bid Template do RFQ mostrou (versão 3.26, 2026-11-08).** As metas e os pesos já vêm dentro
do modelo, por cluster, e o modelo calcula os indicadores da aba *Bid KPIs* a partir das linhas
preenchidas. Diferenças em relação à planilha da LGC:

- Horas-meta = peso_m × metros × meta_h_metro + peso_p × portas × meta_h_porta **+ peso_d ×
  dispositivos × meta_h_dispositivo** (o termo de dispositivos é novo). Portas = Σ qtd × fibras / 2,
  só das linhas de fibra; metros somam fibra e cobre em metro.
- As "horas" dos indicadores são **todas** as horas de mão de obra da Bid (inclui gerente), não só as
  de campo.
- Por isso o perfil de cliente deixa de guardar metas e pesos copiados à mão: o Financeiro **lê do
  Bid Template anexado** as metas do cluster do projeto e mostra a prévia com os mesmos números que a
  AWS verá. O perfil guarda só o que o modelo não traz (eficiência mínima aceita pela LGC, textos).

### 7.4 Valores para o Bid Template

Valores: nome da proposta (código do projeto), início e conclusão, lead time, R$/h e horas por
função, deslocamento por carro/dia e nº de diárias, plataforma (diária/dias), e por tipo de cabo linha
do bid, comprimento médio, quantidade e horas T. Textos de apoio em inglês (ex.: descrição do
deslocamento).

**Bid preenchida (P-14).** O sistema preenche o **Bid Template do próprio RFQ**:

- **O modelo é por RFQ, não um só.** A AWS manda, junto com a SOW, um `.xlsm` já com os dados do
  projeto (FBN, SOW UID, cluster, datas, contato AWS) e a tabela de preços do cluster e da moeda. Ele
  fica anexado ao projeto no Core (`bid_template`) e vem indicado no `project.quote_requested`. O
  Financeiro baixa essa versão; nada do modelo fica no repositório.
- **Como escrever (prova feita em 2026-11-08):** editar o XML das abas dentro do ZIP, só nas células
  de entrada (valor constante; nunca célula com fórmula), mantendo o estilo da célula, e marcar
  `fullCalcOnLoad` no `workbook.xml`. Assim o projeto VBA (`vbaProject.bin`), as tabelas, os nomes, as
  validações e os comentários ficam intactos. Bibliotecas que reescrevem a pasta inteira (ex.:
  ExcelJS) descartam as macros e não servem. Aberto no Excel, o modelo recalculou: valor hora × horas
  chegou ao total e o contador de erros de validação caiu.
- **Onde escrever, sem endereço fixo** (a versão do modelo muda e as linhas andam):
  - Cabeçalho do fornecedor (aba *Summary*): pelos **intervalos nomeados** do modelo — nome do
    fornecedor (como na lista da AWS), contato e e-mail da proposta, nome da proposta (**o código do
    projeto**, como a LGC usa), início e conclusão propostos, data de envio e lead time. Moeda, markups e
    os dados da AWS já vêm no modelo e não são tocados.
  - Linhas (aba *Item Selection*): localizadas pelo **código da coluna C** (part number da AWS ou
    código da linha). Colunas de entrada: B finalidade, G comprimento, J valor unitário (valor hora,
    na mão de obra), M quantidade (horas, na mão de obra), N quantidade do estoque do fornecedor, T
    horas de campo da linha, U comentário.
  - Mão de obra: uma linha por função mapeada (técnico, supervisor, gerente…, cada uma com taxa
    normal, extra e feriado), com valor hora em J e horas em M.
  - Cabos fornecidos pela AWS (conferido com uma Bid real da LGC, 2026-11-08): **G comprimento médio,
    S quantidade instalada digitada por cima da fórmula `=O`** (M e N ficam vazios, então não entra custo
    de material), T horas e U comentário em inglês. Tipos da SOW que caem na mesma linha são somados (ex.:
    Cat6 verde e laranja numa linha livre de cobre, com A descrição, B finalidade, D fornecedor, E código
    e K unidade). O sistema não insere linhas ("duplicar linha" é macro); duas coisas diferentes na mesma
    linha bloqueiam a geração.
  - Linhas com o mesmo código: o modelo pode ter o mesmo part number numa linha com fornecedor definido
    e noutra em "Select". Vale a do fornecedor do perfil ou, sem ele, a que já tem fornecedor; em "Select"
    o fornecedor do perfil é escrito em D.
  - Materiais da LGC: linha do catálogo de materiais pelo campo "referência no formulário do cliente" —
    o código da coluna C ou o **número da linha**, como a LGC anota ("Bid linha 379"), resolvido no Bid
    Template do próprio RFQ. J preço e M quantidade (inteira); linha livre leva também descrição,
    finalidade, fabricante, código e unidade convertida para a lista do modelo (un/pç → `ea`, rolo →
    `roll`, caixa → `box`, metro → `m`; outra → `other`).
  - Condições gerais: deslocamento em *Transportation* (J valor por carro/dia, M diárias), plataforma em
    *Equipment Rental*, hospedagem em *Lodging* e alimentação em *Per Diem*; todas com B finalidade (o
    modelo acusa erro de validação sem a descrição de uso).
  - Bid KPIs: **"Yes"** na coluna F dos indicadores fora da meta (a Bid real não tem texto de
    justificativa no arquivo; a justificativa fica na revisão).
- **Regra de conferência do próprio modelo:** a soma das horas T das linhas tem de ser igual às horas
  das funções de campo (instalador, emendador, técnico, oficial, supervisor). É a mesma regra da §7.2;
  a revisão não submete se divergir.
- O perfil de cliente guarda o mapeamento **tipo de cabo da SOW → código da linha** e **função da
  equipe → código de mão de obra**, mais os valores fixos do cabeçalho (nome do fornecedor, contato).
- A Bid é gerada no servidor ao **aprovar o envio** e guardada na revisão (imutável depois disso); a
  tela também permite baixar uma prévia do rascunho.

## 8. Realizado

**Um único livro (PA-16, PT-07).** Cotado, comprometido e realizado do projeto vêm dos lançamentos do centro de
custo do projeto (`cc_entries`, com `project_axis_id`), a mesma tabela onde entram compras, reembolsos,
adiantamentos, consumo da Logística e folha. **Não existe tabela de custos realizados própria do projeto**
(`actual_cost_entries` saiu do desenho): duas fontes de custo divergem. Correção é estorno, como em todo
lançamento do CC.

Disponível quando o orçamento tem revisão `ganha`. Linha de base = essa revisão.

- **Comprometido** (ao ganhar, [§3.1](#31-revisão)): lançamentos `stage = comprometido`, `source = projeto`, no
  CC do projeto (do cache do Core), com `source_ref = ganho:<revisão>:<linha>` e a competência da aceitação.
  Receita (`faturamento`, o valor contratado da revisão) e os custos diretos do resultado da revisão:

  | Linha | Categoria do CC | De onde vem no resultado da revisão |
  |---|---|---|
  | Receita contratada | `faturamento` | valor da proposta (`revenue`) |
  | Mão de obra | `folha` | `directCosts.labor` |
  | Material | `material` | itens + perdas (`materialDetail`) |
  | Frete do material | `material` | `materialDetail.freight` |
  | Deslocamento | `frota` | `directCosts.travel` |
  | Plataforma | `servicos` | `directCosts.platform` |
  | Hospedagem e alimentação | `despesas_campo` | `directCosts.lodgingMeals` |
  | Outros custos | `outros` | `directCosts.other` |

  Linha zerada não lança; contingência e indiretos não entram (não são gasto do projeto). A revisão `ganha` é
  imutável, então o comprometido não se recalcula: reentrega do evento ou ação manual depois do evento não
  duplicam (a presença de `ganho:<revisão>:*` é a chave de idempotência).
- **Realizado:** o que já chega no CC com o projeto — compra recebida (`compras`), reembolso e prestação de
  adiantamento (`despesas_campo`), consumo de material da Logística (`material`, importado todo dia, ver
  [centros de custo §2](centros-de-custo-especificacao.md#2-origens-dos-lançamentos)), faturamento manual
  (`faturamento`, PA-15: receita realizada segue lançamento manual até haver contas a receber). **Mão de obra
  realizada por projeto** (horas do Field × custo hora médio da função, PA-14) entra com o PT-10; até lá o
  realizado de mão de obra do projeto é zero.
- **Comprometido × realizado (regra escolhida no PT-07):** **sem estorno**. O realizado chega em categorias do
  CC que não casam uma a uma com as linhas do orçamento (compra de material cai em `compras`, não em
  `material`; reembolso cai em `despesas_campo`); estornar o comprometido "conforme chega o realizado" obrigaria
  a inventar esse casamento e a reprocessar lançamentos. Em vez disso o resultado calcula, por grupo,
  **comprometido líquido = máx(0, comprometido − realizado)**. O orçamento anual do CC (`cc-budget-status`)
  **ignora** os lançamentos de origem `projeto`: continua medindo realizado + compras e adiantamentos em aberto,
  como antes ([centros de custo §5](centros-de-custo-especificacao.md#5-orçamento-e-situação)).
- **Resultado do projeto** (`GET /projects/:axisProjectId/result`, `budget:read`; custo só com `budget:read_cost`):
  receita (cotado, comprometido, realizado, a faturar) e custos por **grupo** — os quatro grupos do motor
  (mão de obra; material; deslocamento, plataforma, hospedagem e alimentação; outros) — com cotado (grupos da
  revisão ganha), comprometido, realizado, em aberto (compras e adiantamentos aprovados e ainda não realizados),
  comprometido líquido e saldo (`comprometido − realizado − em aberto`; negativo = acima do orçado). Grupos ↔
  categorias do CC: mão de obra = `folha`; material = `material` + `compras`; deslocamento e estadia = `frota` +
  `servicos` + `despesas_campo`; outros = `outros`. Resultado direto = receita − custos diretos (impostos e
  indiretos não são lançados no CC).
- **Ainda fora (PJ5 original):** apontamento digitado (técnicos, dias, carros) e "fechar/reabrir realizado" ficam
  para depois; o realizado do projeto é o que o CC já tem. Com o contas a pagar (PJ6), o título pago passa a
  entrar no mesmo livro.

## 9. Permissões e perfis

Salário e custo são confidenciais: quem monta a proposta não precisa vê-los.

| Permissão | Descrição |
|---|---|
| `budget:read` | Ver orçamentos: entradas, valores cobrados, indicadores do cliente |
| `budget:read_cost` | Ver custos, impostos, indiretos, lucro, preço mínimo/meta e custo hora |
| `budget:write` | Criar orçamento e editar revisão em rascunho; importar SOW |
| `budget:approve` | Aprovar envio, marcar ganha/perdida, reabrir realizado |
| `budget_params:read` | Ver parâmetros e catálogos (sem salários) |
| `budget_params:read_payroll` | Ver salários e benefícios (leitura auditada) |
| `budget_params:write` | Criar e publicar conjunto de parâmetros, catálogos e perfis de cliente |
| `project_actual:write` | Lançar apontamentos e custos realizados |

| Perfil | Permissões |
|---|---|
| `ORCAMENTISTA` | budget:read/write, budget_params:read |
| `GESTOR_COMERCIAL` | budget:read/read_cost/approve, budget_params:read |
| `GESTOR_PROJETO` | budget:read, project_actual:write |
| `CONTROLADORIA` | budget:read/read_cost, budget_params:read/read_payroll/write, project_actual:write |

Sem `budget:read_cost`, a API **omite** os campos de custo (não basta esconder na tela). Ver P-02 e
P-03.

## 10. Modelo de dados (alvo)

| Tabela | Conteúdo |
|---|---|
| `parameter_sets` | `code` (`PAR-NNNN`), status, `effective_from`, parâmetros gerais (§4.2) em colunas, publicado por/em |
| `parameter_set_roles` | função (§4.1) por conjunto |
| `client_profiles` | perfil de cliente versionado (constantes AWS §7, tabela tipo de cabo → linha do bid) |
| `budget_materials`, `budget_destinations` | catálogos (§4.3) |
| `project_budgets` | `axis_project_id`, `model` (`generico`/`aws_sow`), `client_profile_id?`, `title?`, `planned_start_date?`, `planned_end_date?` (vazios = valores do projeto no Core, §5) |
| `budget_revisions` | número, status, `parameter_set_id`, entradas (`inputs` JSON validado pelo DTO: equipe, material com preço e custo copiados do catálogo, deslocamento, plataforma, hospedagem, alimentação, custos extras), resultado (`result` JSON) e totais em colunas (receita, impostos, diretos, indiretos, lucro, lucro sobre o custo), criado/alterado por e em |
| `budget_revision_team`, `budget_revision_items` | equipe e itens de material/custo da revisão, com valores copiados do catálogo |
| `budget_revision_sow` | dados lidos da SOW, correções e justificativas dos indicadores |
| `budget_revision_cables` | linhas de cabo (§7.2) |
| `budget_alerts` | alertas abertos do orçamento (§3.2): tipo, texto, revisão, evento do Core, quem dispensou (PT-07) |
| `cc_entries` (módulo Centros de custo) | **único livro** do comprometido e do realizado do projeto (§8); `source = projeto` para o comprometido da revisão ganha. Não há `actual_cost_entries` |

Revisão `ganha`/`enviada` e conjunto publicado são imutáveis (checado no serviço e por teste).
Toda mutação em `audit_events`; publicar parâmetros, aprovar envio, ganhar/perder e fechar realizado
gravam evento de negócio com antes/depois.

## 11. API (prefixo `api/v1`)

| Rota | Permissão |
|---|---|
| `GET/POST /parameter-sets`, `GET/PATCH /parameter-sets/:id`, `POST /:id/publish` | budget_params:read / write (salários exigem read_payroll) |
| `GET /parameter-sets/:id/hourly-costs` | budget_params:read_payroll |
| `GET/POST/PATCH /budget-materials`, `/budget-destinations`, `/client-profiles` | budget_params:read / write |
| `GET /projects` (cache do Core com nome, centro de custo e prazo previsto + resumo do orçamento), `GET /projects/:axisProjectId`, `POST /projects/sync` | budget:read |
| `GET/POST /budgets`, `GET /budgets/:id` | budget:read / write |
| `PATCH /budgets/:id` (cabeçalho: título e datas previstas; `null` = valor do Core) | budget:write |
| `POST /budgets/:id/revisions` (nova revisão a partir da última) | budget:write |
| `GET/PATCH /revisions/:id` | budget:read / write |
| `POST /revisions/:id/simulate` (calcula sem gravar) | budget:read |
| `POST /revisions/:id/sow/import` | budget:write |
| `POST /revisions/:id/submit`, `/return`, `/approve-send`, `/won`, `/lost`, `/discard` | budget:write / approve |
| `GET /projects/:axisProjectId/result` (cotado × comprometido × realizado por grupo, lendo só `cc_entries`; sem `budget:read_cost` só a receita) | budget:read |
| `POST /budgets/:id/alerts/:alertId/dismiss` (dispensa um alerta do orçamento) | budget:approve |
| Lançar custo ou receita realizados do projeto | `POST /cost-centers/:id/entries` com `projectId` (centros de custo, `cost_center:write`) |

Valores entram como texto decimal (`"1234.56"`), percentuais como fração (`"0.05"`).

## 12. Telas

1. **Projetos**: projetos do Core com status, orçamento, revisão atual, receita, lucro sobre o custo
   e situação (sem custo para quem não tem `read_cost`). Filtros por status, cliente, situação.
2. **Projeto**: revisões (histórico, quem aprovou), alertas do orçamento (com "Dispensar"), avisos de
   divergência com o Core e, com revisão ganha, **Resultado do projeto**: receita e custos por grupo,
   cotado × comprometido × realizado (§8).
3. **Revisão** (`FormPage` em seções, como a calculadora): cabeçalho, [SOW e cabos], equipe e dias,
   material, deslocamento, plataforma, hospedagem, outros custos; painel lateral com receita, lucro,
   lucro sobre o custo, preço mínimo e preço da meta atualizado por `simulate`; [indicadores e
   valores do bid].
4. **Realizado**: não há tela própria; os lançamentos do projeto estão no CC (`#/centros-de-custo/:id`,
   origem "Revisão ganha" para o comprometido) e a comparação fica no Resultado do projeto.
5. **Parâmetros**: conjunto vigente, rascunho do próximo, comparação entre versões, custo hora por
   função; catálogos de material e destinos; perfis de cliente.

## 13. Integração

- **Projetos e clientes**: cache alimentado por `project.created/updated/status_changed/deleted`,
  `cost_center.created/updated` e `client.created/updated`, e pelo botão "Atualizar do Axis Core", que
  lê `GET /projects` e `GET /clients` do Core com o token de quem clicou (PJ2).
- Desde 2026-11-07 (P-07) todo `project.*` leva o estado completo: nome, cliente, centro de custo
  (id, código e nome), responsável, status e `planned_start_date`/`planned_end_date` (`AAAA-MM-DD`).
  `project.deleted` (exclusão de proposta no Core) chega com `status: 'encerrado'` e `deleted: true` e
  marca o projeto inativo. Nome nulo (projeto antigo) não apaga o nome guardado. A carga por
  `GET /projects` grava as mesmas chaves e preserva o código e o nome do centro de custo vindos do
  webhook (a lista do Core só devolve o id). Contrato: `docs/dominio/cadastros.md` §4 e §10 do Core e
  [integracao-core-financeiro.md §2](../../docs/integracao-core-financeiro.md#2-eventos-core--financeiro).
- Feriados para "cabe na janela": consulta ao calendário do Core; se o Core não expuser, só dias
  úteis com aviso "sem feriados".
- SOW: `project.document_added` e download por
  `GET /integration/projects/:id/documents/:documentId/content` (API key; precisa assinar o evento).

### 13.1 Cotação pedida pelo Core e devolvida ao Core

Contrato completo em [integracao-core-financeiro.md §4](../../docs/integracao-core-financeiro.md#4-cotação-do-projeto).

1. `project.quote_requested` (P-11: alguém clica "Solicitar cotação" no Core) entra na **fila de pedidos
   de cotação** (`quote_requests`) com o recado (`notes`), a SOW e o Bid Template indicados, e atualiza o
   projeto no cache. O orçamento não nasce no webhook (sem parâmetros vigentes o evento falharia e o Core
   reentregaria sem fim): nasce quando o orçamentista clica **"Iniciar cotação"**, que abre o orçamento
   `aws_sow` do projeto (cria na primeira vez), usa o rascunho ou cria nova revisão e importa a SOW do
   pedido. Um pedido novo com SOW nova pode ser reimportado no rascunho.
2. Ao **aprovar o envio** (P-12), o Financeiro gera a Bid (§7.4) e grava na outbox
   `POST /integration/projects/:axisProjectId/quotes` com `external_revision_id`, `revision_number`,
   `sow_document_id`, `work_days`, datas da execução, `team` (por função: pessoas, dias, horas; P-15),
   quem aprovou, `materials[]` (ver abaixo) e a Bid em base64. Retry até o Core responder `201`; `409` vira
   falha para análise. O modelo `generico` devolve do mesmo jeito, só que **sem a Bid** (não há planilha do
   cliente): a mensagem do outbox leva `has_bid: false` e o corpo não tem o campo `bid`.
3. Nunca vão ao Core custo, salário, imposto, indiretos ou lucro.

**Materiais da devolução (PT-05 do plano ponta a ponta, PA-08).** Cada material da revisão tem
`logisticsMaterialCode` (e `logisticsMaterialId`, preenchido na escolha), guardados nas `inputs` da revisão
(JSON, sem migração). O orçamentista escolhe o item numa **busca por nome ou código** no catálogo da Logística
(`GET /logistics-materials?search=`, que o servidor repassa a `GET /integration/materials?search=&limit=` da
Logística com `LOGISTICA_API_KEY`: mínimo 2 caracteres, "contém" sem diferenciar maiúsculas em código ou
descrição, só material ativo, o código igual ao termo vem primeiro; a tela espera ~300 ms depois da digitação).
O caminho por código exato continua (`GET /logistics-materials?code=`, que usa `?codes=`; Enter no campo).
Só vão à tela id, código, descrição e unidade: o custo médio da Logística não é exposto. Se a Logística
estiver fora do ar, a tela mostra o erro ao lado do campo e a edição do orçamento segue normalmente. Regras:
- **Aprovar o envio recusa** a revisão se algum material com quantidade > 0 não tem código (a mensagem
  lista os itens). Vale para `aws_sow` e `generico`. Material avulso do catálogo próprio também precisa do
  código da Logística.
- `materials[]` = `{ material_code, description, unit, quantity }`, sem preço, markup, custo nem frete.
  `quantity` é texto decimal com 3 casas (arredondamento comercial); linha que fica com 0 depois de
  arredondar não vai. O mesmo código em duas linhas vira uma, com a quantidade somada (o Core recusa código
  repetido); unidades diferentes para o mesmo código bloqueiam a aprovação.
- **Perdas:** o motor aplica `materialLossRate` como percentual sobre o **custo**, não sobre a quantidade;
  portanto a quantidade enviada é a orçada, **sem** perdas. Para enviar sobra ao site, some-a na quantidade
  da linha.
- Cabos da SOW no `aws_sow` são fornecidos pela AWS (instalação apenas) e não entram em `materials[]`; só o
  material fornecido pela LGC (seção "Material fornecido pela LGC" da revisão).


### 13.2 Projeto aprovado no Core: ganha sozinha

O Core emite `project.approved` quando o comercial aprova o projeto (plano ponta a ponta §4.2; assinam
Financeiro e Field). O estado completo do projeto vem junto, mais `accepted_quote` (`project_quote_id`,
`external_revision_id` = **id da revisão aqui**, `revision_number`…), `client_po_number` e `approved_at`. O
Financeiro, no receptor `POST /webhooks/axis`:

1. atualiza o projeto no cache (inclusive o centro de custo);
2. acha a revisão por `accepted_quote.external_revision_id`; se estiver `enviada`, passa a `ganha` com a mesma
   transição, histórico e auditoria da ação manual, registrando que veio do Core (ator `sistema:core`, motivo
   "Aprovado no Core (project.approved)", PO, `event_id` e `via: core` na auditoria);
3. lança o comprometido no CC do projeto ([§8](#8-realizado)) na mesma transação.

Idempotência: por `event_id` (inbox) e por revisão (já `ganha` só confirma o comprometido; outro evento da mesma
revisão não relança). Casos sem sobrescrever nada, com alerta no orçamento (§3.2): outra revisão já `ganha` no
mesmo orçamento; revisão que não está `enviada` (ex.: `substituida`). **Revisão que não existe aqui** (ou
`accepted_quote.external_revision_id` ausente, ou revisão de outro projeto): a transação é desfeita, o evento
fica `FAILED` com o motivo em `last_error` e o receptor responde **200** com `{ "status": "failed", "error": … }`
(sem laço de reentrega); se o Core reenviar o mesmo `event_id`, o evento é reprocessado.

## 14. Fora do escopo desta frente

Equipe com dias diferentes por função; OCR de SOW escaneada; custo por colaborador individual (usa-se a média por função); faturamento e contas a receber;
custos realizados vindos do contas a pagar (até ele existir, lançamento manual); orçamento por centro
de custo; outros modelos de cliente além do AWS.

## 15. Diferenças intencionais em relação à planilha

| Planilha | Sistema |
|---|---|
| Parâmetros alterados no lugar; orçamento antigo muda junto | Conjunto versionado; a revisão guarda o que usou |
| Máximo de 8 itens de material e 15 tipos de cabo | Sem limite |
| Material sem custo real vira preço cobrado, sem aviso | Usa o preço cobrado e marca "custo estimado" |
| Realizado repete o material e os outros custos cotados | Usa custos lançados; cotado só como fallback marcado |
| Dias úteis da janela sem feriados (`NETWORKDAYS`) | Com o calendário de feriados |
| Uma pessoa pode alterar tudo | Permissões separadas; custo e salário confidenciais |
| "Nada é enviado sem aprovação" é combinado | Estado `em_aprovacao` e permissão `budget:approve` |

## 16. Entregas

| # | Entrega | Estado |
|---|---|---|
| PJ1 | Parâmetros versionados, funções e custo hora (§6.1), catálogos de material e destinos, permissões e perfis; testes do cálculo com valores fictícios | **feito** (2026-11-07): ver nota abaixo |
| PJ2 | Orçamento genérico: projetos do cache, revisões, motor de cálculo (§6), `simulate`, tela da revisão e resultado; testes de paridade com a planilha | **feito** (2026-11-07): ver nota abaixo |
| PJ3 | Fluxo da revisão (§3): submeter, devolver, aprovar envio, ganha/perdida, avisos de divergência com o Core | **feito** (2026-11-08): ver nota abaixo |
| PJ4 | Modelo `aws_sow`: perfil de cliente, consumo de `project.quote_requested`, SOW em PDF baixada do Core com extração de texto, horas-meta, indicadores, valores do bid | **feito** (2026-11-08), em duas partes: ver notas abaixo. O perfil de cliente com o mapeamento tipo de cabo/função → linha do Bid Template fica para a PJ7, onde é usado |
| PJ5 | Realizado: cotado × comprometido × realizado, lendo os lançamentos do CC (PA-16; sem tabela paralela) | **feito em parte** (2026-11-08, PT-07): comprometido ao ganhar, resultado do projeto por grupo e importação diária do consumo da Logística. Fora: apontamento digitado, fechar/reabrir realizado e mão de obra realizada por projeto (PT-10): ver §8 |
| PJ6 | Custos realizados vindos de títulos do contas a pagar (depende de F2) | pendente |
| PJ7 | Bid preenchida a partir do modelo do cliente (§7.4) e devolução da cotação ao Core ao aprovar o envio (§13.1). Depende de PJ3 e PJ4; o lado do Core está pronto desde 2026-11-08 | **feito** (2026-11-08): ver nota abaixo |

**Notas da PJ1.**
- Migração `20261108120000_pj1_parametros`: tabelas `parameter_sets`, `parameter_set_roles`,
  `budget_materials`, `budget_destinations`; código `PAR-NNNN` por sequence; no máximo um `vigente` e
  um `rascunho` (índices parciais); gatilhos no banco impedem alterar ou apagar conjunto publicado e
  suas funções (só `vigente → arquivado`).
- Primeiro rascunho nasce com as referências legais públicas (jornada, INSS, terceiros, FGTS, PIS,
  COFINS, presunções e alíquotas de IRPJ/CSLL); ISS, RAT, veículo, metas e funções ficam vazios.
  Rascunhos seguintes copiam o vigente.
- Publicar exige os campos obrigatórios e ao menos uma função de campo com valor hora e custo; vigência
  vazia vale a data de hoje (São Paulo) e não pode ser anterior à do vigente.
- Sem `budget_params:read_payroll` a API omite salários, benefícios e custo hora; quem não tem a
  permissão pode editar o nome e o valor hora da função, e a remuneração já cadastrada é preservada.
- O cálculo do custo hora foi conferido contra a planilha atual com os valores reais, fora do
  repositório; os testes versionados usam valores fictícios.
- Telas: `#/parametros` (lista, rascunho, publicação, custo hora com composição), `#/materiais`,
  `#/destinos`. Perfis de cliente (`client_profiles`, §7) ficam para a PJ4.

**Notas da PJ2.**
- Migração `20261108130000_pj2_orcamentos`: `project_budgets` (um por projeto e modelo) e
  `budget_revisions`. As tabelas de linhas previstas em §10 (`budget_revision_team`, `…_items`)
  viraram o JSON `inputs`, validado pelo DTO; os totais ficam em colunas para listar. Um rascunho por
  orçamento (índice parcial); gatilho impede alterar entradas, parâmetros ou resultado fora de
  rascunho e apagar revisão.
- Motor (`budgets/budget-engine.ts`) segue §6.2–§6.7; cada linha é arredondada em 2 casas e os
  totais somam as linhas. Cenário de referência conferido à mão com as fórmulas da planilha.
  Frete da plataforma só entra quando há dias de plataforma (a planilha somava sempre).
- Nova revisão copia a última não descartada e passa a usar os parâmetros vigentes; o rascunho pode
  trocar para o vigente ("Usar PAR-…"). Rascunho pode ser descartado (fica no histórico).
- Projetos e clientes: além do webhook, o botão **"Atualizar do Axis Core"** (`POST /projects/sync`)
  lê `GET /projects` e `GET /clients` do Core com o token de quem clicou (respeita `project:read` e
  `client:read` dessa pessoa); registro mais antigo não sobrescreve o mais novo. URL em `AXIS_API_URL`.
- Sem `budget:read_cost` a API devolve só a parte cobrada (receita, linhas sem custo) e esconde o custo
  real do material; ao salvar, esse custo vem da revisão anterior ou do catálogo.
- Telas: `#/projetos` (lista com orçamento e lucro sobre o custo), `#/projetos/:id` (revisões),
  `#/revisoes/:id` (editor com resultado recalculado pelo servidor enquanto se digita).
- Não verificado ainda: uso na tela com login real (feito só por testes e chamadas sem sessão).
- Dados do Core (P-07, 2026-11-07): migração `20261108140000_pj2_cabecalho_core` (título opcional,
  datas previstas próprias do orçamento). A lista de projetos mostra nome e prazo previsto do Core
  ("Sem nome no Axis Core" para projeto antigo); a página do projeto mostra centro de custo e prazo e
  tem "Editar cabeçalho"; a revisão mostra o título efetivo e o prazo. Regras em §5.

**Notas da PJ3.**
- Migração `20261108150000_pj3_fluxo_revisao`: colunas `submitted_at`, `approved_at`, `approved_by`,
  `approved_by_email` e `decided_at` em `budget_revisions`; tabela `budget_revision_events`
  (append-only por gatilho); índices parciais de no máximo uma revisão `em_aprovacao`, uma `enviada` e
  uma `ganha` por orçamento; gatilho que só aceita as transições do §3.1.
- Rotas `POST /revisions/:id/submit`, `/return`, `/approve-send`, `/won`, `/lost` (`reason` no corpo
  para devolver e perder). Aprovar o envio marca a `enviada` anterior como `substituida` na mesma
  transação.
- Avisos do §3.2 na lista de projetos e na página do projeto ("Feche o realizado" entra com a PJ5).
- Telas: painel "Aprovação" na revisão (ações permitidas, motivo na tela, bloqueios para submeter,
  histórico) e quem aprovou o envio na lista de revisões.
- Conferido: testes do fluxo com Prisma simulado e as cinco migrações aplicadas do zero num Postgres
  em memória (PGlite), com os gatilhos e índices recusando transições inválidas, duas enviadas e
  alteração do histórico. Não verificado ainda: uso na tela com login real.
- A devolução da cotação ao Core ao aprovar o envio fica para a PJ7.

**Notas da PJ4 (parte 1).**
- Migração `20261108160000_pj4_sow_cotacao`: `quote_requests` (fila, única por `axis_quote_request_id`)
  e `budget_revision_sow` (texto original, cabeçalho, racks, linhas lidas e linhas atuais, avisos), com
  gatilho que só deixa mudar a SOW de revisão em rascunho. A nova revisão copia a SOW da anterior.
- Webhook: `project.quote_requested` põe o pedido na fila e atualiza o projeto no cache só com as chaves
  do estado do projeto; `project.document_added` é ignorado (o documento é baixado pelo pedido).
- Download pela API de integração do Core com `AXIS_API_KEY` (nova variável), conferindo o SHA-256 do
  pedido. Extração com `pdfjs-dist` (versão fixa) por linha; PDF sem texto pede para colar o texto.
- Rotas: `GET /quote-requests`, `POST /quote-requests/:id/start` (`budget:write`),
  `POST /revisions/:id/sow/import` (do Core ou `text`), `PUT /revisions/:id/sow/cables` (correção, com
  antes/depois na auditoria), `GET /revisions/:id/sow/text` (`budget:write`, leitura auditada, P-05). A
  revisão traz `sow` (sem o texto).
- Telas: `#/cotacoes` (fila com "Iniciar cotação"/"Continuar cotação") e seção "SOW do cliente" na
  revisão (cabeçalho, racks/live, cabos por tipo com comprimento médio e portas, linhas para conferir e
  corrigir, texto original).
- Conferido: o PDF real das duas SOWs passou pela extração e pelo parser de produção com os mesmos
  totais da conferência manual (fora do Git); testes com SOWs fictícias nos dois formatos e com um PDF
  mínimo gerado no teste; migrações e gatilhos num Postgres em memória. Não verificado: tela com login
  real e download contra um Core rodando.

**Notas da PJ4 (parte 2).**
- Migração `20261108170000_pj4_bid_template`: `revision_bid_template` (arquivo do Bid Template do RFQ e
  metas lidas, só muda em rascunho, copiado na nova revisão) e, em `budget_revision_sow`,
  `field_hours_overrides` (horas T à mão) e `kpi_justifications`.
- Leitura do modelo (`bid/bid-template-reader.ts`, com `jszip` e `fast-xml-parser` em versão fixa):
  cluster, moeda e versão pelos intervalos nomeados da aba *Summary*; metas do cluster na tabela
  `Table8` e câmbio na `Table12` (aba *Bid KPIs*); pesos das horas-meta e tolerâncias pelas próprias
  fórmulas. Fora do formato esperado, vale o padrão da versão 3.26 com aviso. Conferida com o modelo
  real (fora do Git): os números batem com o que a planilha calcula.
- Cálculo (`bid/aws-quote.ts`): horas-meta por tipo = peso_m × qtd × comprimento médio × meta_h_metro +
  peso_p × portas × meta_h_porta; o termo de dispositivos fica 0 (o modelo só conta linhas de
  dispositivo preenchidas, o que uma proposta só de cabeamento não tem). Dias sugeridos, dias úteis da
  janela da SOW (segunda a sexta; **feriados ainda não entram**, aviso na tela), horas T proporcionais
  com sobra na primeira linha ou digitadas à mão, indicadores com meta, desvio e tolerância do modelo,
  e os valores para a Bid. As "horas" dos indicadores são todas as horas de mão de obra.
- A meta de mão de obra por porta do cluster vem muito baixa no modelo (§7.3: "meta do cliente
  inconsistente"), então esse indicador sai sempre fora da meta e pede justificativa — sem regra
  especial no código.
- Submeter uma revisão `aws_sow` exige SOW e Bid Template importados, horas T somando as horas de campo
  e justificativa em todo indicador fora da meta (vai em `workflow.submitBlockers` e é conferido no
  servidor ao submeter).
- Rotas: `POST /revisions/:id/bid-template/import`, `PUT /revisions/:id/aws/hours`,
  `PUT /revisions/:id/aws/justifications` (`budget:write`); a revisão traz `aws` (metas, cotação,
  bloqueios). "Iniciar cotação" importa a SOW e o Bid Template.
- Tela: painel "Cotação AWS" na revisão (metas do cluster, horas-meta, dias sugeridos × janela, horas T
  por tipo, indicadores com justificativa em inglês, valores para a Bid).
- Conferido: testes do leitor com uma planilha mínima fictícia, do cálculo com números conferidos à mão
  e do serviço; migrações e gatilhos num Postgres em memória. Não verificado: tela com login real.

**Notas da PJ7.**
- Migração `20261108180000_pj7_bid_envio`: `bid_profile_entries` (fornecedor e mapeamento tipo de
  cabo / função → linha do Bid Template, único por tipo e chave) e `revision_bid_output` (Bid gerada,
  append-only por gatilho).
- Escritor (`bid/xlsx-editor.ts`, `bid/bid-plan.ts`, `bid/bid-fill.ts`): edita o XML só das células de
  entrada; recusa célula com fórmula (exceto a S das linhas de cabo) e célula base de fórmula
  compartilhada; remove o `calcChain` quando troca fórmula por valor e marca `fullCalcOnLoad`. Nome do
  arquivo como a LGC usa: `AAAA-MM-DD_BID_<FBN>_<site>_v<revisão>.xlsm`.
- Funções padrão (decisão do dono em 2026-11-08): técnico → *Technician*, encarregado → *General
  Foreman / Site Supervisor*, gerente → *Project Manager*, todas na taxa normal; dá para trocar no perfil.
- **Conferência com a Bid real** (fora do Git): preenchida a partir do modelo em branco com os números da
  Bid da LGC, a planilha gerada, aberta no Excel, deu os mesmos totais de mão de obra, condições gerais e
  cabo (zero), as mesmas portas, horas e metros nos indicadores, horas de campo = horas por cabo e
  **zero erros de validação**.
- **Aprovar envio** (`POST /revisions/:id/approve-send`) numa revisão `aws_sow` gera a Bid antes (se
  faltar algo, a revisão continua em aprovação com o motivo) e, na mesma transação da aprovação, grava
  a Bid e a mensagem `project_quote.ready` no outbox. A transição direta sem a Bid é recusada.
- **Entrega ao Core:** o despachante do outbox manda `project_quote.ready` para
  `POST /integration/projects/:id/quotes` com `AXIS_API_KEY`, juntando a Bid guardada na revisão ao
  retrato da cotação (equipe por função, dias, datas, SOW, quem aprovou). 400/403/404/409 vão direto
  para a dead-letter; rede e 5xx seguem o retry. Sem `AXIS_API_KEY` a mensagem fica pendente.
- Rotas: `GET/PUT /bid-profile`, `GET /revisions/:id/bid/lines`, `GET /revisions/:id/bid/plan`,
  `GET /revisions/:id/bid/preview` (`budget:write`, prévia sem gravar), `GET /revisions/:id/bid/output`.
- Tela: parte "Bid para a AWS" no painel da cotação (situação, fornecedor, linha de cada tipo de cabo e
  função, prévia e Bid enviada).
- Verificado em 2026-11-08 no ambiente de desenvolvimento do dono: cotação aprovada, entregue ao Core e
  marcada como ganha.
- **Pré-preenchimento pela SOW (pedido do dono em 2026-11-08), tudo editável:**
  - *Equipe:* sempre 1 encarregado; técnicos e dias para as horas de campo cobrirem as horas-meta da AWS
    dentro da janela da SOW (menor equipe que cabe na janela, depois os menores dias). Aplicada ao iniciar a
    cotação quando a equipe está vazia; botão "Aplicar equipe sugerida" recalcula. Conferido com a Bid real:
    176,4 h e janela de 7 dias úteis → 1 encarregado + 3 técnicos × 6 dias.
  - *Linha de cada tipo de cabo:* sem mapeamento salvo, o sistema sugere a linha pelo número de fibras e pelas
    pontas da descrição (MTP = MPO, leque de LC = LC), preferindo monomodo, amarelo, linha com fornecedor e o
    fornecedor mais usado no perfil; cobre vai para a linha livre de cobre. O plano da Bid usa a sugestão; a
    tela marca "sugerida pela SOW" e "Confirmar" grava no perfil. Conferido: com a preferência pela AFL, a
    sugestão escolhe as mesmas linhas da Bid real.
  - "Continuar cotação" num rascunho que já tem a SOW e o Bid Template do mesmo pedido não reimporta
    (preserva cabos corrigidos, horas T e justificativas).

## 17. Decisões pendentes

| # | Pergunta | Recomendação |
|---|---|---|
| P-01 | Projetos antes de contas a pagar? | Sim (pedido do dono em 2026-11-07); F1–F6 continuam na especificação, depois de PJ1–PJ5 |
| P-02 | Quem vê custo, lucro e salários? Quais pessoas recebem cada perfil? | Custo e lucro para gestor comercial e controladoria; salários só para controladoria |
| P-03 | Quem aprova o envio? Quem orçou pode aprovar a própria revisão? | Aprovação pelo dono/gestor comercial; no início, permitir a mesma pessoa, com auditoria |
| P-04 | Custo hora do realizado: parâmetros da revisão ganha ou os vigentes na execução? | Os da revisão ganha (compara só o que mudou na obra); mostrar os vigentes como informação |
| P-05 | Guardar o texto original da SOW (documento do cliente)? | Guardar, com acesso restrito a `budget:write`, e prazo de retenção definido |
| P-06 | Catálogo de material próprio ou o catálogo de materiais do Core com preço e custo? | **Resolvida (2026-11-08)**: o catálogo próprio continua dono de preço cobrado e custo real; o material da cotação ganha o **código do catálogo da Logística** (`logisticsMaterialCode`, com `logisticsMaterialId` opcional), obrigatório para aprovar o envio (PA-08). O vínculo com o Core é pelo `material_code` na devolução (§13.1) |
| P-07 | O projeto do Core deve ganhar nome (e o evento trazer nome e centro de custo)? | **Resolvida (2026-11-07)**: o Core ganhou nome e prazo previsto e emite o estado completo em `project.*` e `cost_center.*`; o Financeiro usa nome e prazo no cabeçalho do orçamento (§5) |
| P-08 | Planilhas preenchidas de projetos reais para validar o cálculo | Usar fora do Git, só para conferir; testes versionados com números fictícios |
| P-09 | Manter o adicional de IRPJ sobre toda a presunção (conservador)? | Manter até a contabilidade confirmar |
| P-10 | Valores a revisar na carga inicial: salário igual para técnico e encarregado, ISS no teto, rateio/contingência/prazo em 0, R$/km estimado, gerente sem valor | Revisar com a contabilidade antes de publicar o primeiro conjunto |
| P-11 | O projeto vai ao Financeiro sozinho ou alguém pede a cotação? | **Resolvida (2026-11-08)**: alguém clica "Solicitar cotação" no Core (`project.quote_requested`) |
| P-12 | Quando o Financeiro devolve a cotação ao Core? | **Resolvida (2026-11-08)**: ao aprovar o envio; cada nova revisão aprovada chega como nova versão |
| P-13 | Formato da SOW anexada no Core | **Resolvida (2026-11-08)**: PDF com texto; extração conferida com duas SOWs reais (dois formatos de cabos, §7.1) |
| P-14 | O que é a "planilha Bid preenchida"? | **Resolvida (2026-11-08)**: o Bid Template do próprio RFQ (um por projeto, anexado no Core como `bid_template`), preenchido por edição direta das células de entrada, preservando macros (§7.4) |
| P-15 | "Colaboradores orçados" é quantidade ou pessoas nomeadas? | **Resolvida (2026-11-08)**: quantidade por função × dias (horas para o gerente) |
