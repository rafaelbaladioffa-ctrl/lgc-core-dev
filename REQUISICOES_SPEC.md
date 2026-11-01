# AXIS ERP | SGI — Módulo de Requisições Intersetoriais

**Empresa:** LGC
**Documento:** Especificação funcional e técnica pronta para vibe coding
**Versão:** 1.0
**Idioma/localidade:** pt-BR / BRL / `America/Sao_Paulo`
**Status:** base recomendada para implementação; limites de alçada devem ser configuráveis

---

## 1. Objetivo

Implementar no Axis ERP | SGI um módulo único de requisições intersetoriais, orientado por catálogo, formulários dinâmicos e workflows configuráveis. O módulo deve permitir abrir, aprovar, encaminhar, executar, acompanhar, concluir, confirmar e auditar solicitações entre todos os setores da LGC.

O sistema não deve ser um formulário genérico com troca de mensagens. Cada categoria deve definir:

- setor e fila responsáveis;
- formulário e validações;
- documentos obrigatórios;
- aprovadores e alçadas;
- SLA de resposta e solução;
- regras de visibilidade e segregação;
- transições permitidas;
- evidências necessárias para conclusão;
- integrações e registros gerados em outros módulos.

## 2. Premissas e decisões de projeto

1. Os códigos e nomes da estrutura organizacional exibida no Axis são a fonte inicial deste catálogo.
2. Setores-pai e subsetores podem possuir filas, responsáveis, categorias, SLAs e permissões próprios.
3. Usuários, empresas, unidades, setores, cargos, centros de custo, projetos, contratos, fornecedores, clientes, itens, ativos e veículos devem vir dos cadastros mestres existentes.
4. Valores de alçada deste documento são sugestões iniciais e devem ser administráveis, sem código fixo.
5. Toda aprovação é registrada no servidor; aprovação por simples comentário não é válida.
6. Nenhuma mudança de status crítica depende apenas do frontend.
7. Registros operacionais não são excluídos fisicamente; cancelamento e inativação preservam histórico.
8. Dados de RH, DP, Jurídico, Compliance, SST e Financeiro podem ser marcados como restritos.
9. O motor de workflow será comum a todas as categorias, com versões publicadas e preservação da versão usada na abertura.

## 3. Estrutura organizacional atendida

| Código | Setor/subsetor | Pai | Escopo principal no módulo |
|---|---|---|---|
| 100 | Diretoria | — | decisões estratégicas, exceções e alçadas executivas |
| 1000 | Jurídico | — | contratos, pareceres, contencioso e documentos legais |
| 1000.1 | Compliance | Jurídico | integridade, denúncias, conflito de interesses e LGPD |
| 200 | Comercial | — | propostas, condições comerciais e oportunidades |
| 200.1 | Clientes | Comercial | cadastro, atendimento, documentos e ocorrências de clientes |
| 300 | Projetos | — | abertura, planejamento, mudanças e encerramento de projetos |
| 400 | Operações | — | mobilização, execução operacional e recursos de campo |
| 400.1 | Qualidade | Operações | não conformidades, inspeções, documentos e melhoria |
| 500 | RH | — | recrutamento, desenvolvimento, movimentação e benefícios |
| 500.1 | DP | RH | admissão, férias, ponto, folha e desligamento |
| 600 | HSE/SST | — | segurança, saúde, meio ambiente, incidentes e requisitos legais |
| 700 | Financeiro | — | pagamentos, recebimentos, reembolsos e adiantamentos |
| 800 | Suprimentos | — | compras, fornecedores e contratações |
| 800.1 | Almoxarifado e Patrimônio | Suprimentos | estoque, entrega, devolução, transferência e ativos |
| 800.2 | Frota | Suprimentos | veículos, abastecimento, manutenção, multas e sinistros |
| 900 | TI | — | acessos, equipamentos, sistemas, suporte e segurança |
| ADM | Administração | — | facilities, viagens, correspondências, eventos e serviços gerais |

## 4. Perfis e permissões

### 4.1 Perfis funcionais

| Perfil | Capacidades principais |
|---|---|
| Solicitante | criar rascunho, enviar, acompanhar, complementar, cancelar quando permitido e avaliar |
| Solicitante em nome de terceiro | abrir para outro usuário com justificativa e trilha de representação |
| Gestor do solicitante | aprovar custos, prioridade, ausência, impacto e aderência ao centro de custo |
| Triagem do setor | validar escopo, classificar, devolver, recategorizar e atribuir |
| Atendente/Executor | assumir, executar, registrar horas, custos, evidências e concluir |
| Gestor da fila | distribuir, alterar prioridade justificada, escalonar, substituir responsável e gerir SLA |
| Aprovador | aprovar, reprovar ou devolver; sem editar silenciosamente a solicitação |
| Especialista consultado | emitir parecer sem assumir a decisão final |
| Auditor | leitura de registros, versões e trilha, sem alteração operacional |
| Administrador do catálogo | configurar categorias, campos, SLA e workflow em rascunho/publicação |
| Administrador do sistema | configuração técnica, sem direito automático a dados restritos |

### 4.2 Regras de autorização

- Aplicar RBAC com escopo por empresa, unidade, setor, fila e classificação de confidencialidade.
- O solicitante visualiza suas requisições e aquelas explicitamente compartilhadas.
- Gestores visualizam registros de sua hierarquia apenas quando a categoria permitir.
- Equipes responsáveis visualizam a fila e os anexos necessários ao atendimento.
- Requisições `RESTRITA` exibem conteúdo somente a participantes autorizados; demais usuários veem, no máximo, metadados mínimos.
- Denúncias permitem anonimato ou confidencialidade reforçada. O denunciado e sua cadeia conflitante nunca participam da triagem.
- Usuários não podem aprovar a própria requisição quando houver impacto financeiro, contratação, benefício próprio, conflito ou exceção.
- Delegações de aprovação exigem início, fim, escopo e auditoria; não podem ser retroativas.
- Permissão no frontend nunca substitui verificação no backend.
- Download, exportação e impressão respeitam a mesma política de acesso do registro.

## 5. Estados e ciclo de vida

### 5.1 Estados canônicos

`RASCUNHO` → `ENVIADA` → `EM_TRIAGEM` → `AGUARDANDO_APROVACAO` → `APROVADA` → `PLANEJADA` → `EM_ATENDIMENTO` → `AGUARDANDO_SOLICITANTE`/`AGUARDANDO_TERCEIRO` → `CONCLUIDA` → `ENCERRADA`

Estados alternativos: `DEVOLVIDA_AJUSTE`, `REPROVADA`, `CANCELADA`, `SUSPENSA`, `REABERTA` e `EXPIRADA`.

### 5.2 Regras de transição

- Rascunho é privado e editável pelo autor ou representante.
- Envio valida campos, anexos, vínculos e versão publicada da categoria.
- Triagem pode aceitar, devolver, recategorizar ou encaminhar; toda alteração deve ter motivo.
- A edição de campo material após aprovação invalida as aprovações afetadas e reinicia o fluxo a partir da etapa definida.
- Aprovações paralelas podem exigir `TODOS`, `QUALQUER_UM` ou `N_DE_M`.
- Reprovação exige justificativa; a categoria define se encerra ou permite nova submissão.
- Pendência com solicitante pausa somente o SLA de solução, nunca o SLA de primeira resposta; depende de motivo e prazo.
- Conclusão exige resolução e evidências da categoria.
- Encerramento pode ser automático após 3 dias úteis sem contestação, configurável por categoria.
- Reabertura é permitida por 5 dias úteis se o mesmo problema persistir; depois disso cria nova requisição relacionada.
- Cancelamento após compra, pagamento, mobilização ou execução iniciada depende do gestor da fila e registra impactos.
- Status, responsável, prioridade, prazo e aprovadores nunca podem ser alterados sem evento de auditoria.

## 6. Campos comuns a todas as requisições

| Campo | Tipo/regra |
|---|---|
| `id` | UUID imutável |
| `codigo` | amigável e sequencial por ano, ex.: `REQ-2026-000123` |
| empresa/unidade | seleção dos cadastros permitidos ao usuário |
| setor solicitante | preenchido pelo vínculo ativo; alteração justificada |
| solicitante/beneficiário | usuário; permite terceiro conforme permissão |
| setor/categoria/subcategoria de destino | catálogo publicado e pesquisável |
| título | 10–120 caracteres, objetivo e pesquisável |
| descrição/justificativa | texto rico seguro; mínimo configurável |
| prioridade solicitada | baixa, normal, alta ou crítica; crítica exige impacto |
| data necessária | data; deve respeitar antecedência mínima da categoria |
| projeto/contrato/cliente | condicionais e provenientes de cadastros mestres |
| centro de custo/conta | obrigatórios quando houver custo |
| valor estimado | decimal; máscara `R$ 1.234,56`; armazenamento exato |
| recorrência | única, mensal, anual ou outra; quando aplicável |
| confidencialidade | interna, confidencial ou restrita; default da categoria |
| anexos | tipo, tamanho, malware scan, hash e versão |
| observadores | somente usuários autorizados |
| termos/declarações | aceite versionado quando exigido |
| origem | web, mobile, integração, e-mail autorizado ou API |
| metadados | criador, datas, versão do catálogo, IP/sessão conforme política |

### 6.1 Padrões de campo

- Moeda: BRL, visual `R$ 1.234,56`, persistência `DECIMAL(19,4)` e API em string decimal.
- Datas: visual `DD/MM/AAAA`; API ISO 8601; data/hora armazenada em UTC e exibida em `America/Sao_Paulo`.
- CPF, CNPJ, CEP, telefone, placa, percentuais e unidades com máscara e validação sem misturar valor e apresentação.
- Campos condicionais são validados novamente no servidor.
- Selects extensos usam pesquisa, paginação e identificação por ID, nunca texto livre quando existir cadastro mestre.

## 7. Catálogo de requisições por setor

As categorias abaixo são o catálogo mínimo recomendado. Cada linha pode gerar uma configuração de categoria e um schema de formulário.

### 7.1 Diretoria — 100

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Aprovação executiva excepcional | decisão requerida, alternativas, recomendação, impacto financeiro, riscos, prazo, pareceres | gestor da origem → áreas impactadas/Financeiro/Jurídico conforme tema → diretor competente | resposta 1d; decisão 5d úteis |
| Investimento/CAPEX | ativo/projeto, business case, valor, payback, orçamento, cotações, riscos | gestor → Financeiro → Suprimentos → Diretoria; Conselho se alçada exigir | 2d/10d |
| Política ou norma corporativa | documento, objetivo, escopo, áreas impactadas, vigência, revisão | dono do processo → Jurídico/Compliance/Qualidade → Diretoria | 2d/10d |
| Exceção a política/alçada | regra, motivo, período, beneficiário, risco, compensações | dono da política → Compliance/Jurídico → Diretoria | 1d/5d |
| Assinatura da Diretoria | documento final, signatário, contraparte, prazo, validação jurídica | Jurídico confirma versão → Diretoria assina | 1d/3d |

### 7.2 Jurídico — 1000

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Elaboração/revisão de contrato | tipo, partes/CNPJ, objeto, valor, vigência, índice, minuta, responsável, prazo | gestor demandante → Financeiro/Compliance conforme risco → Jurídico → signatários | 1d/7d; complexo 15d |
| Aditivo/rescisão | contrato, alteração, motivo, impacto, data efetiva, evidências | gestor do contrato → Financeiro → Jurídico → alçada | 1d/7d |
| Parecer jurídico | pergunta objetiva, fatos, documentos, decisão esperada | triagem → advogado responsável → gestor Jurídico se alto risco | 1d/5d |
| Procuração/documento societário | finalidade, outorgante, outorgado, poderes, validade | gestor → Jurídico → Diretoria/signatário | 1d/5d |
| Contencioso/notificação | parte, processo/notificação, prazo fatal, valor, fatos, documento | prioridade automática por prazo → Jurídico → Diretoria se material | 4h/2d |
| Assinatura eletrônica | documento validado, signatários, ordem, validade, plataforma | Jurídico valida → coleta de assinaturas → arquivamento | 1d/3d |

### 7.3 Compliance — 1000.1

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Due diligence de terceiro | terceiro/CNPJ, serviço, país, valor, sócios, PEP, sanções, documentos | Compliance analisa → Jurídico/Financeiro se alerta → aprovação por risco | 1d/7d |
| Conflito de interesses | partes, vínculo, decisão, período, declaração | Compliance → gestor independente → Diretoria se material | 1d/5d |
| Brindes, hospitalidade e doações | ofertante/beneficiário, valor, ocasião, vínculo público | gestor → Compliance → Diretoria acima da alçada | 1d/3d |
| Denúncia/relato ético | canal, relato, envolvidos, local/data, evidências; identidade opcional | triagem independente → investigação → comitê → plano de ação | acolhimento 24h; plano 10d |
| LGPD/dados pessoais | titular, sistema, dados, finalidade, incidente/solicitação, prazo legal | encarregado/Compliance → TI/Jurídico → áreas responsáveis | 4h para incidente; demais 3d |
| Aprovação de política de integridade | minuta, requisito, riscos, treinamento e vigência | Compliance → Jurídico → Diretoria | 2d/10d |

### 7.4 Comercial — 200

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Proposta comercial | oportunidade, cliente, escopo, prazo, preço, impostos, margem, validade | Comercial → Projetos/Operações → Financeiro → Jurídico → Diretoria por alçada | 1d/5d |
| Desconto/condição excepcional | tabela, desconto, margem resultante, concorrência, justificativa | gestor Comercial → Financeiro → Diretoria conforme alçada | 4h/2d |
| Participação em licitação/RFP | edital, prazos, requisitos, garantias, documentação | Comercial → Jurídico/Compliance → Técnico → Financeiro → Diretoria | triagem 4h; entrega pelo cronograma |
| Visita/demonstração | cliente, objetivo, participantes, data, custo, oportunidade | gestor Comercial; Administração para logística | 1d/3d |
| Material/campanha comercial | público, canal, texto/arte, orçamento, período | gestor Comercial → Jurídico/Compliance se afirmações/dados | 1d/5d |
| Cadastro/alteração de preço | item/serviço, custo, impostos, margem, vigência | Comercial → Financeiro → Diretoria conforme impacto | 1d/3d |

### 7.5 Clientes — 200.1

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Cadastro/alteração de cliente | razão social, CNPJ, endereço, contatos, segmento, documentos | Clientes → Compliance/Financeiro → Comercial | 1d/3d |
| Documentação/certidão para cliente | cliente, lista, finalidade, portal, vencimento | Clientes distribui às áreas donas → revisão → envio | 4h/2d |
| Reclamação/ocorrência de cliente | cliente, contrato/projeto, fato, impacto, evidência, prazo | Clientes → Operações/Qualidade → plano/resposta → confirmação | resposta 4h; solução 5d |
| Pesquisa/satisfação | cliente, projeto, contato, método e período | gestor Comercial/Clientes | 1d/5d |
| Alteração cadastral/portal | cliente, portal, dado, acesso e evidência | triagem → área dona → validação | 1d/3d |
| Visita técnica do cliente | pauta, local, participantes, requisitos de acesso/SST | Clientes → Operações/Projeto/HSE → Administração | 1d/5d |

### 7.6 Projetos — 300

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Abertura de projeto | cliente/contrato, escopo, datas, orçamento, gerente, centro de custo | Comercial → Financeiro → Operações → Diretoria por alçada | 1d/5d |
| Alteração de escopo/prazo/custo | baseline, mudança, causa, impacto, nova previsão, aceite cliente | gerente → áreas impactadas → Comercial/Financeiro → cliente/alçada | 1d/5d |
| Alocação de equipe/recurso | projeto, função/recurso, período, carga, local | gestor do recurso → RH/Operações conforme caso | 1d/3d |
| Kickoff/reunião de marco | projeto, pauta, participantes, entregáveis, data | gerente do projeto | 1d/3d |
| Risco ou impedimento | risco, probabilidade, impacto, dono, mitigação, data limite | gerente → sponsor → Diretoria se crítico | crítico 2h/1d; normal 1d/3d |
| Encerramento do projeto | aceite, pendências, custos, lições, documentos, desmobilização | gerente → Operações/Financeiro/Qualidade → sponsor | 2d/10d |

### 7.7 Operações — 400

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Mobilização/desmobilização | projeto, local, pessoas, datas, cliente, recursos e requisitos | gestor → RH/DP/HSE/TI/Frota/Almoxarifado em paralelo | 1d; execução por data |
| Programação de serviço | contrato, OS, local, equipe, janela, escopo, recursos | coordenação Operações → áreas de apoio | 4h/2d |
| Recurso operacional | equipamento/material/pessoa, quantidade, período e local | gestor → estoque/frota/RH → custo se necessário | 1d/3d |
| Hora extra/turno especial | equipe, datas, horas, motivo, projeto, custo | gestor → DP → Diretoria conforme política | antes da execução; 1d |
| Ocorrência operacional | local, projeto, evento, impacto, evidências, ação imediata | triagem → Qualidade/HSE/Projeto conforme natureza | crítica 1h; normal 4h |
| Paralisação/retomada | motivo, risco, cliente, equipe, impacto, autorização | Operações → HSE/Qualidade/Projeto → Diretoria se material | imediato/4h |

### 7.8 Qualidade — 400.1

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Não conformidade (RNC) | origem, requisito, evidência, severidade, contenção, responsável | Qualidade classifica → dono trata → verifica eficácia → encerra | contenção 24h; plano 5d |
| Ação corretiva/preventiva | causa raiz, método, ação, responsável, prazo, indicador | gestor do processo → Qualidade valida eficácia | 2d/30d |
| Revisão de documento SGI | documento/código, tipo de mudança, motivo, versão proposta | elaborador → revisor → aprovador → publicação controlada | 2d/7d |
| Inspeção/auditoria | escopo, norma, local, checklist, equipe e data | Qualidade planeja → executa → plano de ação | 2d; relatório 5d |
| Calibração de instrumento | instrumento, patrimônio/série, faixa, vencimento, certificado | gestor → Qualidade → fornecedor/Almoxarifado | antes do vencimento; 10d |
| Melhoria de processo | problema/oportunidade, baseline, ganho, risco, dono | gestor do processo → Qualidade → Diretoria se investimento | 2d/10d |

### 7.9 RH — 500

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Requisição de vaga | cargo, motivo, quantidade, regime, local, salário/faixa, centro de custo | gestor → RH → Financeiro → Diretoria conforme headcount | 2d/7d |
| Movimentação/promoção | colaborador, atual/proposto, salário, motivo, data | gestor → RH → Financeiro → Diretoria | 2d/7d |
| Treinamento/desenvolvimento | curso, fornecedor, participantes, custo, objetivo, validade | gestor → RH → HSE se obrigatório → alçada financeira | 2d/5d |
| Benefício/auxílio | colaborador, benefício, dependentes, vigência, documentos | RH → gestor/Financeiro conforme política | 2d/5d |
| Avaliação/clima/conflito | envolvidos, contexto, período, confidencialidade | RH restrito → gestor independente/mediação | acolhimento 1d; plano 5d |
| Declaração/carta de RH | tipo, finalidade, idioma, destinatário, prazo | RH valida e emite | 1d/3d |

### 7.10 Departamento Pessoal — 500.1

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Admissão | candidato, cargo, salário, início, unidade, documentos, exame | vaga aprovada → RH → DP → HSE/TI/gestor | antecedência 5d; concluir até admissão |
| Férias | colaborador, período aquisitivo, datas, abono/adiantamento | gestor → DP valida regras → programação | solicitar 30d antes; resposta 5d |
| Ajuste de ponto | data, marcação correta, motivo, evidência | colaborador → gestor → DP | até fechamento; 2d |
| Afastamento/atestado | colaborador, período, tipo, documento; saúde restrita | DP/Saúde ocupacional → gestor recebe apenas necessário | acolhimento 4h; 2d |
| Alteração cadastral/dependente | dado, vigência, documento comprobatório | DP valida | 2d/5d |
| Desligamento | colaborador, tipo, motivo, data, aviso, pendências | gestor → RH → Diretoria conforme caso → DP; tarefas paralelas | imediato; cronograma legal |
| Dúvida de folha/holerite | competência, rubrica, descrição | DP restrito → correção/explicação | 1d/3d |

### 7.11 HSE/SST — 600

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Incidente/acidente/quase acidente | data/hora, local, envolvidos, descrição, lesão, ação imediata, evidências | notificação imediata → HSE → gestor → investigação/comunicações legais | imediato/24h inicial |
| Permissão/análise de trabalho | atividade, local, riscos, equipe, controles, validade | executor → supervisor → HSE → cliente quando exigido | antes da atividade; 4h |
| EPI/EPC | item, CA quando aplicável, quantidade, motivo, colaborador/local | gestor → HSE valida → Almoxarifado entrega | urgente 2h; normal 2d |
| Exame ocupacional | colaborador, tipo, função, riscos, data | DP/RH → HSE/clínica; resultado médico restrito | conforme prazo legal |
| Treinamento obrigatório | norma, função, turma, validade, local | gestor → HSE → RH/Compras se custo | 2d; antes da mobilização |
| Inspeção/condição insegura | local, risco, fotos, ação imediata | HSE classifica → responsável corrige → verificação | crítico imediato; normal 5d |
| Meio ambiente/resíduo | tipo, quantidade, local, destinação, documento | HSE → Operações/Suprimentos → evidência de destinação | 1d/5d |

### 7.12 Financeiro — 700

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Pagamento a fornecedor | fornecedor/CNPJ, pedido/contrato, documento fiscal, vencimento, valor, rateio | solicitante/recebimento → gestor → Fiscal/Financeiro → alçada | 1d; conforme calendário |
| Reembolso | beneficiário, despesas, datas, projeto/CC, comprovantes, dados bancários | gestor → Financeiro → alçada; política automática | 2d/5d |
| Adiantamento | beneficiário, finalidade, valor, período, prestação prevista | gestor → Financeiro → alçada | 2d/5d |
| Prestação de contas | adiantamento, despesas, comprovantes, saldo/devolução | gestor → Financeiro; bloqueia novo adiantamento vencido | 2d/5d |
| Cadastro/alteração bancária | titular, banco, agência, conta, comprovação | validação reforçada e dupla checagem independente | 1d/3d |
| Faturamento/nota de saída | cliente, contrato, medição, valor, impostos, vencimento, aceite | Projeto/Comercial → Fiscal/Financeiro → emissão | 1d/3d |
| Cobrança/baixa/conciliação | cliente/título, valor, vencimento, evidência | Financeiro → Comercial quando disputa | 1d/3d |

### 7.13 Suprimentos — 800

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Compra de material | itens, especificação, quantidade, unidade, data/local, valor estimado | gestor → estoque confirma → orçamento → Suprimentos → alçada | resposta 1d; compra 5–15d |
| Contratação de serviço | escopo, local, período, entregáveis, medição, orçamento | gestor → HSE/TI/Jurídico conforme risco → Suprimentos → alçada | 2d/15d |
| Compra emergencial | necessidade, impacto, justificativa, fornecedor/valor | gestor → Suprimentos → Financeiro/Diretoria conforme alçada; revisão posterior | resposta 2h; solução 1d |
| Cadastro/homologação de fornecedor | CNPJ, categoria, dados, documentos, banco | Suprimentos → Compliance → Financeiro → HSE/Qualidade por categoria | 2d/10d |
| Cotação/renegociação | escopo/itens, fornecedores, condições, prazo | Suprimentos → requisitante valida técnica → mapa comparativo → alçada | 2d/7d |
| Aditivo/renovação de fornecedor | contrato, desempenho, alteração, valor e vigência | gestor do contrato → Suprimentos → Jurídico/Financeiro → alçada | iniciar 30d antes; 10d |

### 7.14 Almoxarifado e Patrimônio — 800.1

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Requisição de material em estoque | item, quantidade, projeto/CC, local, destinatário | gestor conforme item → reserva → separação → entrega confirmada | 4h/2d |
| Devolução de material | item/lote, quantidade, condição, origem | Almoxarifado inspeciona → entrada/baixa/avaria | 1d/2d |
| Transferência entre locais | item/ativo, origem/destino, responsável, transporte | gestores origem/destino → movimentação → aceite | 1d/3d |
| Entrega/devolução de patrimônio | ativo, usuário, local, condição, termo | gestor → Patrimônio → aceite do custodiante | 1d/3d |
| Inventário/ajuste de estoque | item/ativo, contagem, divergência, motivo, evidência | responsável → gestor → Controladoria/Financeiro conforme valor | 1d/5d |
| Baixa/alienação de ativo | ativo, condição, laudo, valor contábil, destino | gestor → Patrimônio → Financeiro → Diretoria | 2d/10d |

### 7.15 Frota — 800.2

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Reserva de veículo | condutor/CNH, veículo/classe, destino, período, projeto | gestor → Frota valida disponibilidade/documentos | 4h/2d |
| Manutenção preventiva/corretiva | veículo, km, sintoma/serviço, urgência, orçamento | Frota → gestor → Suprimentos/alçada se custo | imobilizado crítico 2h; normal 5d |
| Abastecimento | veículo, condutor, km, litros, valor, posto, comprovante | validações de consumo → Frota/Financeiro em exceções | 1d/2d |
| Multa | auto, veículo, data/local, condutor, prazo, defesa | Frota identifica → condutor/gestor → Jurídico/Financeiro | 1d; antes do prazo |
| Sinistro | veículo, envolvidos, local/data, danos, BO/fotos, seguradora | imediato → Frota/HSE/Jurídico → seguradora/gestor | imediato/24h |
| Documentação/licenciamento | veículo, documento, vencimento, taxa | Frota → Financeiro → arquivo | iniciar 30d antes |

### 7.16 TI — 900

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Acesso a sistema/perfil | usuário, sistema, perfil, empresa/unidade, início/fim, motivo | gestor → dono do sistema → TI; Compliance para privilégio crítico | 4h/2d |
| Criação/alteração/bloqueio de usuário | pessoa, sistemas, data efetiva, vínculos | RH/DP ou gestor autorizado → donos → TI | admissão/desligamento conforme data; crítico 1h |
| Equipamento/periférico | item, especificação, usuário, local, período, motivo | gestor → TI → Patrimônio/Suprimentos se necessário | 1d/5d |
| Incidente/suporte | serviço, erro, impacto, usuários, evidência, contato | triagem por impacto → suporte → especialista → resolução | P1 15min/4h; P2 1h/8h; P3 4h/3d; P4 1d/5d |
| Mudança em sistema | sistema, requisito, benefício, risco, critérios, janela | dono do processo → TI analisa → CAB/dono → implementação/testes | análise 3d; entrega planejada |
| Integração/relatório/dados | origem/destino, campos, frequência, finalidade, acesso | dono dos dados → TI → LGPD/Compliance se pessoal | análise 3d |
| Incidente de segurança | ativo/conta, evento, horário, impacto, evidência | canal urgente → Segurança/TI → Compliance/LGPD/Diretoria | resposta 15min; contenção 4h |

### 7.17 Administração — ADM

| Categoria | Campos específicos obrigatórios | Aprovação/fluxo | SLA sugerido |
|---|---|---|---|
| Viagem/hospedagem | viajante, destino, datas, objetivo, projeto/CC, preferências | gestor → Administração → Financeiro/alçada | solicitar 10d antes; cotação 3d |
| Sala/evento/reunião | local, data, participantes, recursos, alimentação, custo | gestor quando houver custo → Administração | 1d/3d |
| Manutenção predial/facilities | local, problema, risco, fotos, acesso | triagem → HSE se risco → fornecedor/equipe | crítico 1h; normal 5d |
| Limpeza/copa/serviços gerais | local, serviço, frequência, data | Administração atribui e confirma | 4h/2d |
| Correspondência/malote/cartório | tipo, remetente/destinatário, prazo, rastreio, documento | Administração → Jurídico se documento legal | 1d/3d |
| Acesso físico/crachá/chave | pessoa, local, nível, período, motivo | gestor → responsável da área → Administração | 1d/3d |
| Mudança de layout/posto | local, pessoas, planta, data, recursos | gestor → Administração → TI/HSE/Patrimônio | 2d/10d |

## 8. Prioridade, impacto e urgência

O solicitante informa urgência e impacto; o sistema calcula a prioridade inicial. A triagem pode alterar com justificativa.

| Impacto \ Urgência | Baixa | Média | Alta | Imediata |
|---|---:|---:|---:|---:|
| Individual/baixo | P4 | P4 | P3 | P3 |
| Equipe/projeto | P4 | P3 | P2 | P2 |
| Unidade/cliente | P3 | P2 | P1 | P1 |
| Empresa, segurança, legal ou indisponibilidade crítica | P2 | P1 | P1 | P1 |

- P1: atendimento contínuo até estabilização, escalonamento imediato.
- P2: alto impacto, atuação prioritária.
- P3: operação degradada ou necessidade normal com prazo.
- P4: melhoria, dúvida ou baixa urgência.
- O usuário não pode usar prioridade crítica sem impacto, evidência e contato disponível.

## 9. Workflows e alçadas

### 9.1 Blocos reutilizáveis

1. **Aprovação gerencial:** gestor atual do solicitante ou gestor do centro de custo.
2. **Validação técnica:** dono do processo, sistema, item, projeto ou contrato.
3. **Validação orçamentária:** saldo e classificação pelo Financeiro, sem substituir aprovação de gasto.
4. **Compras:** verificação de estoque/contrato, cotação e pedido por Suprimentos.
5. **Jurídico/Compliance/HSE/Qualidade/TI:** incluídos por regras de risco e assunto.
6. **Aprovação de alçada:** selecionada por valor agregado, empresa, categoria e período.
7. **Execução paralela:** subtarefas independentes com barreira de conclusão.
8. **Aceite do solicitante:** obrigatório nas categorias de entrega, mudança ou serviço.

### 9.2 Matriz financeira inicial recomendada

Valores são parâmetros de implantação, não constantes no código.

| Valor total comprometido | Aprovação mínima sugerida |
|---:|---|
| até R$ 1.000,00 | gestor do centro de custo |
| R$ 1.000,01 a R$ 10.000,00 | gestor + gerente da área |
| R$ 10.000,01 a R$ 50.000,00 | gerente + Financeiro |
| R$ 50.000,01 a R$ 100.000,00 | gerente + Financeiro + Diretor responsável |
| acima de R$ 100.000,00 | Financeiro + Diretoria conforme governança |

Regras adicionais:

- calcular alçada pelo valor total do compromisso, incluindo recorrência e impostos, nunca apenas parcela mensal;
- detectar fracionamento por solicitante, fornecedor, centro de custo, objeto e janela configurável;
- conflito de interesse pula o aprovador e escala ao substituto independente;
- sem orçamento exige etapa de exceção, motivo e alçada superior;
- mudança de valor que cruza faixa reinicia aprovações necessárias;
- aprovação financeira não confirma recebimento de material/serviço.

## 10. SLA e calendário

### 10.1 Medições

- **Primeira resposta:** de `ENVIADA` ao primeiro atendimento humano válido.
- **Triagem:** de `ENVIADA` até aceite/devolução/encaminhamento.
- **Aprovação:** tempo em cada etapa e total de aprovações.
- **Solução:** de `ENVIADA` até `CONCLUIDA`, descontando pausas autorizadas.
- **Encerramento:** de `CONCLUIDA` até `ENCERRADA`.

### 10.2 Regras

- Calendário por empresa/unidade com horário útil, feriados e plantões.
- `AGUARDANDO_SOLICITANTE` pausa solução somente depois de uma pergunta objetiva; limite padrão de 5 dias úteis.
- Aprovação, fila interna, indisponibilidade do responsável e reatribuição não pausam SLA.
- Sistema registra meta original, meta atual, pausas e motivo.
- Alertas em 50%, 80%, 100% e escalonamentos posteriores configuráveis.
- Escalonar ao atendente, gestor da fila, gestor do setor e patrocinador conforme criticidade.
- Alteração manual de prazo exige motivo, nova data, autorizador e notificação.
- Dashboard mede cumprimento por categoria, setor, prioridade e responsável, sem manipular o histórico.

## 11. Regras de negócio transversais

1. Categoria publicada é versionada; requisições antigas mantêm schema e workflow originais.
2. Recategorização preserva histórico, recalcula SLA segundo regra explícita e executa validação do novo formulário.
3. Campos materiais: valor, beneficiário, fornecedor, projeto, centro de custo, escopo, datas e itens; mudança pode invalidar aprovação.
4. Uma requisição pode gerar subtarefas, mas mantém responsável coordenador e condição de encerramento.
5. Duplicidade: alertar registros semelhantes abertos pelo mesmo solicitante, ativo, documento fiscal, cliente ou evento.
6. Documentos fiscais, CPF/CNPJ, contrato, patrimônio, placa e número de processo têm validações e índices próprios.
7. Anexo substituído cria nova versão; nunca sobrescrever silenciosamente.
8. Comentário pode ser público aos participantes ou nota interna da fila; ambos auditados.
9. Menções notificam apenas usuários que já podem acessar o registro.
10. Nenhuma notificação concede permissão.
11. Toda ação assíncrona deve ser idempotente e tolerar repetição.
12. Ações críticas usam confirmação explícita; alterações bancárias e privilégios elevados podem exigir MFA/reautenticação.
13. Ao desligar usuário, itens pendentes são reatribuídos e delegações encerradas.
14. Requisições relacionadas permitem vínculo `depende_de`, `bloqueia`, `duplica`, `origina` e `subtarefa_de`.
15. Dados sensíveis seguem minimização, retenção e acesso por necessidade.

## 12. Notificações

Canais: central do Axis e e-mail; push/Teams/WhatsApp apenas por integração aprovada.

Eventos mínimos: envio, devolução, aprovação pendente, aprovação/reprovação, atribuição, pergunta, menção, prazo próximo, SLA violado, conclusão, reabertura e cancelamento.

- Preferências do usuário podem reduzir notificações informativas, nunca avisos críticos ou obrigações.
- Agrupar lembretes repetitivos; evitar uma mensagem por alteração automática.
- Mensagem inclui código, título, ação requerida e link seguro, sem expor dado restrito no assunto.
- Falha de envio não desfaz a ação; registrar tentativa, erro e retentativa.

## 13. Modelo de dados mínimo

### 13.1 Entidades

| Entidade | Campos essenciais |
|---|---|
| `request_categories` | id, code, name, department_id, parent_id, confidentiality, active |
| `category_versions` | id, category_id, version, form_schema, workflow_schema, sla_policy_id, published_at, published_by |
| `requests` | id, code, category_version_id, company_id, unit_id, requester_id, beneficiary_id, department ids, title, description, priority, confidentiality, status, due dates, value, currency, lock_version |
| `request_field_values` | request_id, field_key, typed values/json, encrypted flag |
| `request_participants` | request_id, user/group, role, visibility scope |
| `assignments` | request_id, queue_id, assignee_id, started_at, ended_at, reason |
| `workflow_instances` | request_id, definition version, current node, state |
| `workflow_steps` | instance, node, type, status, actor/resolver, due_at, decided_at, decision, reason |
| `approvals` | step_id, approver_id, delegation_id, decision, comment, snapshot_hash, timestamp |
| `request_comments` | request_id, author, visibility, body, created/edited metadata |
| `attachments` | owner, version, filename, mime, size, storage_key, hash, scan_status, classification |
| `sla_clocks` | request_id, metric, target, started/paused/stopped, elapsed, breach |
| `sla_pauses` | clock_id, start/end, reason, actor |
| `request_relations` | source_id, target_id, relation_type |
| `worklogs` | request_id, user, date, minutes, description, cost |
| `audit_events` | aggregate, id, event, actor, timestamp, before/after diff, correlation, source |
| `notifications` | event, recipient, channel, template, status, attempts |
| `delegations` | delegator, delegate, scope, starts/ends, approved_by, revoked_at |
| `queues` | department, name, members, routing rules, schedule |
| `approval_authority_rules` | scope, thresholds, role/user resolver, valid dates, priority |

### 13.2 Restrições técnicas

- UUID como chave interna; `codigo` único e amigável.
- `DECIMAL`, nunca `float`, para dinheiro; moeda ISO 4217.
- Controle otimista por `lock_version`/ETag.
- Índices por código, status, setor, fila, responsável, solicitante, categoria, prioridade, prazos e datas.
- Soft delete apenas para configurações; operações usam estados de negócio.
- JSON Schema é aceito para formulários, mas campos críticos pesquisáveis devem ser normalizados/indexados.
- Criptografia em trânsito e em repouso; proteção adicional para dados sensíveis.
- Auditoria append-only, com retenção configurável e integridade verificável.

## 14. API REST recomendada

Prefixo: `/api/v1`. Autenticação existente do Axis; JSON UTF-8; datas ISO 8601; paginação por cursor ou padrão consistente do ERP.

### 14.1 Catálogo e formulários

- `GET /request-catalog?department_id=&q=&requester_id=` — categorias permitidas.
- `GET /request-categories/{id}/form-schema` — schema publicado e metadados.
- `POST /request-categories` — cria rascunho administrativo.
- `POST /request-categories/{id}/versions/{version}/publish` — publica versão após validação.

### 14.2 Requisições

- `POST /requests` — cria rascunho; aceita `Idempotency-Key`.
- `GET /requests/{id}` — detalhe filtrado por campo/permissão.
- `PATCH /requests/{id}` — edição com `If-Match`/versão.
- `POST /requests/{id}/submit`
- `POST /requests/{id}/triage` — aceitar, devolver, recategorizar, encaminhar.
- `POST /requests/{id}/assign`
- `POST /requests/{id}/start`
- `POST /requests/{id}/request-information`
- `POST /requests/{id}/resume`
- `POST /requests/{id}/complete`
- `POST /requests/{id}/close`
- `POST /requests/{id}/reopen`
- `POST /requests/{id}/cancel`
- `GET /requests` — filtros, ordenação e paginação autorizados.

### 14.3 Aprovação, colaboração e arquivos

- `GET /approvals/inbox`
- `POST /workflow-steps/{id}/decision` — `APPROVE`, `REJECT`, `RETURN`; idempotente.
- `POST /requests/{id}/comments`
- `POST /requests/{id}/attachments/initiate` e `/complete` — upload seguro.
- `GET /requests/{id}/timeline`
- `GET /requests/{id}/audit` — somente perfis autorizados.
- `POST /requests/{id}/relations`
- `POST /requests/{id}/worklogs`

### 14.4 Contrato de erro

```json
{
  "type": "https://axis.lgc/errors/validation",
  "title": "Dados inválidos",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "correlation_id": "uuid",
  "errors": [{ "field": "estimated_value", "code": "required", "message": "Informe o valor estimado." }]
}
```

Usar `400` sintaxe, `401` autenticação, `403` autorização, `404` inexistente ou oculto, `409` conflito/versão, `422` regra de negócio, `429` limite e `5xx` erro interno sem detalhes sensíveis.

### 14.5 Exemplo de criação

```json
{
  "category_id": "uuid",
  "company_id": "uuid",
  "unit_id": "uuid",
  "title": "Aquisição de EPI para mobilização",
  "description": "Materiais necessários para início do projeto.",
  "requested_priority": "NORMAL",
  "needed_by": "2026-11-15",
  "project_id": "uuid",
  "cost_center_id": "uuid",
  "estimated_value": "3450.90",
  "currency": "BRL",
  "fields": {
    "items": [{ "item_id": "uuid", "quantity": "20", "unit": "UN" }]
  }
}
```

## 15. UI/UX

### 15.1 Telas

1. **Portal de solicitações:** busca, favoritos, recentes e catálogo agrupado por setor.
2. **Nova requisição:** stepper Categoria → Dados → Revisão → Envio; autosave de rascunho.
3. **Minhas requisições:** filtros salvos, pesquisa, chips de status/SLA e exportação autorizada.
4. **Caixa de aprovações:** decisão individual e em lote somente quando homogênea e segura.
5. **Fila do setor:** visão tabela/kanban, responsável, SLA, prioridade, filtros e distribuição.
6. **Detalhe:** cabeçalho, dados, workflow, subtarefas, anexos, comentários, linha do tempo e ações contextuais.
7. **Painel gerencial:** volume, backlog, aging, SLA, gargalos, devoluções, reaberturas e satisfação.
8. **Administração:** categorias, versões, campos, roteamento, SLA, alçadas, filas, calendários e templates.

### 15.2 Comportamento

- Mostrar somente ações permitidas, mas retornar erro claro se a permissão mudar durante a sessão.
- Exibir prazo e SLA como data absoluta e indicador relativo.
- Campos monetários sempre com `R$`; datas `DD/MM/AAAA`; horário 24h.
- Salvar rascunho automaticamente e avisar sobre alterações não salvas.
- Pré-visualizar resumo e aprovadores prováveis antes do envio.
- Linha do tempo distingue evento do sistema, decisão, comentário e nota interna.
- Não usar somente cor para status; garantir teclado, foco, contraste e leitores de tela.
- Responsivo para abertura, aprovação e acompanhamento; administração avançada pode priorizar desktop.
- Estados obrigatórios: carregando, vazio, erro, acesso negado, offline/retry e sucesso.
- Proteção contra duplo clique e reenvio; feedback imediato sem prometer ação ainda não persistida.

## 16. Anexos e documentos

- Tipos permitidos configuráveis; recomendação inicial: PDF, DOCX, XLSX, PNG, JPG e arquivos técnicos autorizados.
- Tamanho padrão: 25 MB por arquivo e 100 MB por requisição, configurável.
- Bloquear executáveis e extensões duplas perigosas.
- Varredura antimalware antes de disponibilizar download.
- Nome seguro, MIME validado pelo conteúdo, hash SHA-256, autor, data, versão e classificação.
- URL de download temporária e autorizada; nunca expor caminho de armazenamento.
- Documento obrigatório pode ter validade, emissor, número e data de vencimento.
- Exclusão lógica de anexo somente antes do envio ou por administrador autorizado; manter evento e hash.

## 17. Auditoria, privacidade e retenção

Auditar: criação, leitura de registro restrito quando exigido, alterações, transições, aprovações, delegações, downloads, exports, mudanças de permissão, publicação de catálogo, SLA e integrações.

Cada evento contém ator real e representado, data/hora, origem, correlação, objeto, ação, resultado e diff mascarado. Senhas, tokens, segredos, dados bancários completos e conteúdo médico não entram em logs gerais.

- Auditoria não editável pela interface.
- Exportações recebem marca d'água/metadados e são auditadas.
- Política de retenção varia por categoria e obrigação legal; deve ser configurável e aprovada por Jurídico/Compliance.
- Atender direitos de titular sem apagar registros que devam ser preservados legalmente; anonimizar quando aplicável.
- Ambientes não produtivos não devem receber dados pessoais reais sem proteção.

## 18. Integrações e automações

- **Cadastros mestres:** usuários, organograma, clientes, fornecedores, projetos, contratos, centros de custo, itens, ativos e veículos.
- **Financeiro:** orçamento, títulos, pagamentos, reembolsos, adiantamentos e conciliação.
- **Suprimentos/Estoque:** requisição de compra, cotação, pedido, reserva, movimentação e recebimento.
- **RH/DP:** admissão, férias, ponto, movimentação e desligamento.
- **TI/IAM:** provisionamento e bloqueio de acessos com confirmação de execução.
- **Assinatura eletrônica:** envelope, signatários, status e documento final.
- **Mensageria:** outbox transacional, webhooks assinados, retentativa e dead-letter queue.

Webhooks mínimos: `request.created`, `request.submitted`, `request.status_changed`, `approval.requested`, `approval.decided`, `request.assigned`, `request.completed`, `sla.warning` e `sla.breached`.

## 19. Relatórios e indicadores

- Volume aberto/encerrado por período, setor, categoria e unidade.
- Backlog e aging por faixa.
- SLA de primeira resposta e solução; percentis P50/P90/P95.
- Tempo em cada etapa e gargalos de aprovação.
- Taxa de devolução, reprovação, cancelamento, reabertura e recorrência.
- Carga por fila e responsável, sem uso isolado para avaliação individual indevida.
- Gastos solicitados/aprovados/executados por centro de custo, projeto e categoria.
- Satisfação pós-atendimento e comentários.
- Exportação CSV/XLSX/PDF conforme permissão, filtros e mascaramento.
- Indicadores usam dados históricos imutáveis e mostram data da última atualização.

## 20. Requisitos não funcionais

- Disponibilidade, backup, RPO e RTO conforme padrão corporativo do Axis.
- Listagens comuns: resposta p95 ≤ 2 s; detalhe p95 ≤ 2 s; ações p95 ≤ 3 s, excluindo integrações externas.
- Paginação obrigatória; evitar N+1 e consultas sem índice.
- Processos longos assíncronos com status visível.
- Logs estruturados, métricas, tracing/correlation ID e alertas.
- Cobertura de testes focada em autorização, workflow, alçadas, SLA, dinheiro e concorrência.
- Migrações reversíveis e compatíveis; feature flag para implantação gradual.
- Segurança alinhada a OWASP ASVS aplicável: validação, CSRF, XSS, injection, SSRF, rate limit e gestão de sessão.
- Compatibilidade com navegadores suportados pelo Axis e acessibilidade WCAG 2.1 AA nos fluxos essenciais.

## 21. Critérios de aceite

### 21.1 Catálogo e formulário

- [ ] Todos os 17 setores/subsetores deste documento aparecem conforme permissão.
- [ ] Cada categoria possui código, dono, formulário, SLA, workflow e versão publicada.
- [ ] Alterar uma versão não modifica requisições já abertas.
- [ ] Campos condicionais, máscaras e validações funcionam igualmente no frontend e backend.
- [ ] Valores aparecem em BRL e são calculados sem erro de ponto flutuante.

### 21.2 Workflow e aprovações

- [ ] O sistema resolve aprovadores por hierarquia, alçada e conflito de interesse.
- [ ] O solicitante não aprova o próprio benefício/gasto quando segregação for exigida.
- [ ] Decisão exige usuário autenticado, data, etapa e snapshot do conteúdo aprovado.
- [ ] Mudança material invalida e reinicia as aprovações corretas.
- [ ] Delegação expirada ou fora do escopo é recusada.
- [ ] Transições inválidas retornam erro de negócio e não alteram dados.

### 21.3 SLA e atendimento

- [ ] Relógios consideram calendário, feriado e prioridade.
- [ ] Pausa ocorre apenas nos estados e motivos autorizados.
- [ ] Alertas e escalonamentos não são duplicados.
- [ ] Reatribuição não apaga o tempo anterior nem reinicia meta indevidamente.
- [ ] Dashboard reconcilia com os eventos auditáveis.

### 21.4 Permissões e segurança

- [ ] Testes garantem isolamento entre empresas, unidades, setores e registros restritos.
- [ ] URL direta e API recusam ação que a UI oculta.
- [ ] Comentários, anexos, timeline, exportação e busca respeitam a mesma autorização.
- [ ] Denúncias não revelam identidade ou conteúdo a envolvidos sem autorização.
- [ ] Upload malicioso é bloqueado e registrado.

### 21.5 Dados e integrações

- [ ] Envio repetido com a mesma chave de idempotência não cria duplicidade.
- [ ] Concorrência gera `409` sem sobrescrever alteração de outro usuário.
- [ ] Falha externa entra em retentativa e não deixa status falso de sucesso.
- [ ] Auditoria registra before/after, ator e correlação para eventos relevantes.
- [ ] Exclusão/cancelamento preserva histórico conforme retenção.

### 21.6 UX e acessibilidade

- [ ] Usuário consegue abrir, localizar e acompanhar uma requisição sem conhecer o organograma.
- [ ] Erros são exibidos em português junto aos campos e preservam dados preenchidos.
- [ ] Interface possui estados de carregamento, vazio, falha e sucesso.
- [ ] Fluxos essenciais funcionam por teclado e em viewport móvel.
- [ ] Aprovação mostra conteúdo, valor, anexos e mudanças relevantes antes da decisão.

## 22. Cenários de teste obrigatórios

1. Compra abaixo e acima de cada faixa de alçada.
2. Alteração de valor após aprovação cruzando uma faixa.
3. Solicitante também seria aprovador; sistema encontra substituto.
4. Aprovador ausente com delegação válida, inválida e expirada.
5. Duplo clique/retry na criação, aprovação e pagamento integrado.
6. Requisição P1 fora do horário útil com plantão.
7. Pausa aguardando solicitante, resposta e retomada do relógio.
8. Usuário de outra empresa tentando ler ID conhecido, anexo e exportação.
9. Recategorização para formulário com novos obrigatórios.
10. Desligamento com acessos, ativos e tarefas paralelas; barreira de conclusão.
11. Denúncia envolvendo gestor da cadeia normal.
12. Upload infectado, MIME falso, arquivo grande e versão substituta.
13. Atualização simultânea por dois atendentes.
14. Falha da integração depois de persistir a requisição e retentativa segura.
15. Reabertura dentro e fora da janela.
16. Feriado, horário de verão/fuso e virada de ano no cálculo do SLA.
17. Valor `R$ 0,01`, grande valor, arredondamento, impostos e recorrência anual.
18. Busca e relatório sem vazamento de campo restrito.

## 23. Estratégia de implementação

### Fase 1 — Fundação

- entidades, catálogo versionado, campos dinâmicos, estados, filas, permissões e auditoria;
- portal, nova requisição, minhas requisições, detalhe e fila;
- notificações internas/e-mail e SLA básico;
- categorias prioritárias: TI, Financeiro, Suprimentos, RH/DP e Administração.

### Fase 2 — Governança

- workflow visual/configurável, alçadas, delegações, conflitos e calendários;
- anexos seguros, subtarefas, aceite, reabertura e dashboards;
- Jurídico, Compliance, HSE/SST, Qualidade e Operações.

### Fase 3 — Integração e escala

- integrações transacionais com ERP, estoque, IAM, assinatura e RH;
- Comercial, Clientes, Projetos, Frota, Patrimônio e Diretoria;
- webhooks, observabilidade, relatórios avançados e otimização.

## 24. Definition of Done

Uma história só está concluída quando:

- regra funcional, autorização e validação no servidor estão implementadas;
- interface usa componentes e padrões pt-BR do Axis;
- testes unitários, integração e autorização cobrem os cenários críticos;
- migração, índices, auditoria, logs e métricas foram considerados;
- falhas, loading, vazio, retry e concorrência estão tratados;
- documentação de API e configuração foi atualizada;
- revisão de segurança/privacidade foi feita quando aplicável;
- critérios de aceite passaram em ambiente de homologação;
- não há dados fixos de usuário, setor, alçada, moeda apresentada ou aprovador no código.

## 25. Prompt operacional para a IA de desenvolvimento

Ao implementar este módulo, trate este documento como requisito funcional e técnico. Antes de codificar:

1. inspecione arquitetura, design system, autenticação, cadastros e convenções existentes;
2. reutilize componentes e entidades existentes;
3. apresente o recorte da fase/história e os impactos;
4. implemente verticalmente banco, backend, autorização, frontend, testes e auditoria;
5. não invente IDs, usuários, alçadas ou integrações inexistentes;
6. mantenha configurações administráveis e versionadas;
7. aplique automaticamente pt-BR, BRL, `America/Sao_Paulo`, acessibilidade, responsividade e mensagens claras;
8. preserve dados e funcionalidades atuais; mudanças destrutivas exigem plano explícito;
9. só declare concluído após executar os testes relevantes e informar limitações restantes.

---

## 26. Parâmetros que a LGC deve validar antes da produção

- nomes oficiais dos cargos, gestores, empresas e unidades;
- matriz financeira e competência de cada diretor;
- calendários, plantões e SLAs contratuais;
- categorias que aceitam abertura em nome de terceiro;
- política de anonimato e investigação de denúncias;
- prazos legais, retenção e classificação documental;
- sistemas integrados e donos de dados;
- limites/tipos de anexos;
- categorias restritas e grupos autorizados;
- critérios de satisfação e encerramento automático.

## 27. Decisões de negócio registradas (Fase 2)

### 27.1 Armazenamento de anexos seguros — decisão consciente, revisitar antes de produção real

Decisão do usuário (2026-11-01): manter o armazenamento de anexos em `BYTEA` no Postgres por enquanto (solução temporária já implementada no incremento de anexos seguros), e decidir o armazenamento definitivo (S3/MinIO ou equivalente) em um momento posterior. Antimalware real (ex. ClamAV) não será implementado por ora — a validação de MIME real por magic bytes, bloqueio de executáveis por assinatura/extensão e limites de tamanho já implementados são considerados suficientes por enquanto.

Isto é uma decisão consciente de escopo, não uma lacuna esquecida: revisitar antes de qualquer uso em produção real com dados sensíveis ou arquivos grandes, pois `BYTEA` no Postgres não escala bem para esse caso e não há varredura de malware de verdade.

### 27.2 Aprovação automática sem aprovador no topo da hierarquia — mantido como está

Caso extremo identificado em testes: um solicitante sem ninguém acima na cadeia hierárquica (ex. admin/diretor) abre uma requisição — inclusive de alto valor na alçada financeira dinâmica — e a cadeia de aprovação fica vazia, aprovando automaticamente sem nenhum aprovador.

Decisão do usuário (2026-11-01): manter como está. É consequência da regra geral já estabelecida em todo o sistema ("nível ausente na cadeia é pulado automaticamente, nunca bloqueia o fluxo"), levada ao seu caso extremo. Nenhum aprovador de fallback (ex. papel fixo Conselho/Diretoria) foi definido para este caso.

Esses itens são parametrização de implantação e não impedem construir a fundação do módulo.
