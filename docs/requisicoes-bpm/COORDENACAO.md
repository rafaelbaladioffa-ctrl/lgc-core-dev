# Coordenação Sol / Luna

Data: 01/11/2026. Os identificadores abaixo foram fornecidos pela coordenação. Após a entrega do planejamento, o usuário autorizou o encaminhamento direto e foi enviada ao Luna a orientação para iniciar somente P01.

| Papel | Modelo escolhido pelo usuário | Chat | Host |
|---|---|---|---|
| Arquitetura, pacotes e revisão | GPT-6.1 Sol | Este chat; iniciado pelo chat coordenador `01a199e2-4245-7983-a7b4-ec79e0d26424` | local |
| Implementação | GPT-5.6 Luna | `01a199ef-9f4d-7493-8a3c-a8769964b6fa`, título “Requisições — Luna \| Implementação” | local |

## Limites desta etapa

Sol escreve apenas `docs/requisicoes-bpm/`. Não implementa código, executa migrations/seeds, inicia containers ou apaga dados. A restrição inicial de aguardar o fechamento do projeto foi atendida; o usuário autorizou o envio e P01 foi encaminhado ao Luna para implementação. Não criar chats nem subagentes. Não avançar a P02 antes da revisão do primeiro pacote.

## Ciclo de um pacote

1. Quando a implementação for iniciada pelo usuário/coordenador, encaminhar o arquivo do pacote e seus documentos normativos, não uma lista improvisada de campos.
2. Luna atualiza `git status`/diff, registra arquivos que editará e diferenças preexistentes relevantes. Assume exclusivamente os arquivos da aplicação durante o pacote. Sol revisa e documenta; não edita os mesmos arquivos.
3. Luna entrega um pacote por vez, com telas, regras, persistência, erros, autorização e evidências. Ao encontrar impedimento, agrupa questões com recomendação; continua no que independe delas. Não redefine regra homologada unilateralmente.
4. Sol revisa diffs e evidências contra o aceite. Resultado: `aceito`, `ajustes necessários` ou `bloqueado por decisão`, com motivos e cenários reproduzíveis. Sol não declara homologação de negócio sem evidência do responsável.
5. Só após aceite segue o próximo pacote. Pacote incompleto continua aberto, mesmo com build verde.

Estados: `especificado → em implementação → em revisão → em homologação → concluído`. Usar `bloqueado` apenas com impedimento concreto. Em 02/11/2026, jornada consolidada revisada por Sol: **13 testes DOM e 18 de backend confirmados; corrigir payload HTTP e retenção de tentativa rejeitada, depois prosseguir as pendências de P01**. Sem aceite do pacote; P02 não liberado. Relatório atual em `evidencias/P01/revisao-jornada/REVISAO.md`; rodadas anteriores preservadas como histórico.

## Conteúdo mínimo do retorno de Luna

- Identificação do pacote e recorte efetivamente entregue.
- Arquivos criados/alterados, migrations preparadas/aplicadas e ambiente exato; o que já era alteração do usuário.
- Comandos executados, resultados reais e caminhos das evidências em `docs/requisicoes-bpm/evidencias/Pxx/`.
- Roteiro por persona, URLs e capturas sem informações sensíveis; sucesso, negação e erro/conflito.
- Cenários não executados e motivo; decisões pendentes, limitações e riscos concretos.
- Ausência de regressão nos pontos preservados. Não anexar `.env`, tokens ou dump de dados pessoais.

Não há automação de comunicação ou monitoramento contínuo configurada. Estes IDs tornam possível uma coordenação explícita posterior, sem prometer que mensagens serão enviadas automaticamente.

## Retomada em 02/11/2026

O usuário informou que alterou o modelo do implementador e autorizou continuar com maior rapidez. O modelo da tabela acima registra a escolha inicial; a retomada preservou as configurações atuais do mesmo chat, sem impor outro modelo.

A revisão do checkpoint 7 identificou problemas na hidratação da versão do rascunho, salvamento de título/descrição, versão usada no envio, preservação das edições durante upload e acesso às ações de execução na rota de detalhe. As correções foram encaminhadas diretamente ao implementador, junto com a configuração de testes DOM reais.

A próxima entrega deve consolidar a jornada criar rascunho → editar/salvar → retomar → anexar → enviar → assumir/concluir atividade → encerrar, com testes de interação e um retorno curto. Evitar novos checkpoints que apenas repitam as pendências centrais. Esse marco não substitui os critérios A01–A24: P01 continua aberto e P02 não está liberado. Sol mantém a revisão e não edita a aplicação em paralelo.

## Atualização do ambiente existente autorizada

Em 02/11/2026, o usuário perguntou se podia testar e autorizou: “pode por no que eu tenho existente”. Isso amplia a etapa para disponibilizar o piloto no Axis local existente, preservando os dados. O Docker foi localizado no Ubuntu/WSL2; o sandbox Windows não alcançava esses serviços. Backend/frontend/PostgreSQL existentes estão nas portas 3000/5173/5432.

O implementador é o único executor da implantação. Sol continua com leituras, revisão e documentação. Antes de alterar o banco existente: preservar imagens anteriores, backup consistente privado e ensaiar migration/testes numa cópia descartável. Não executar seed operacional, reset, remoção de dados/volumes ou atualização do satélite. Não inferir autorização para produção remota.

A revisão mais recente confirmou 19 testes DOM e 47 de backend passando e a correção dos payloads HTTP. Persistem validação PostgreSQL/HTTP, preservação de máscaras no terminal, replay de criação após troca do ponteiro e aceite A01–A24. Ver `evidencias/P01/revisao-contratos/REVISAO.md`. P01 continua aberto; P02 não liberado.

Atualização concluída: migration P01 aplicada após backup e ensaio na cópia; backend/frontend recriados com `docker-compose.p01.override.yml`, sem seed operacional. O implementador registrou 20 testes DOM, 48 backend e 4 PostgreSQL passando, além do smoke HTTP. Sol confirmou a migration aplicada, a API BPM exigindo autenticação, o portal antigo acessível e, na sessão existente, o menu “Processos (piloto)” e o formulário da publicação P01-PILOTO v2. Máscaras históricas e replay de criação foram corrigidos. Nenhuma requisição de teste foi criada por Sol no banco existente. Ver `evidencias/P01/DEPLOY-PILOTO-EXISTENTE.md` e captura `evidencias/P01/revisao-contratos/piloto-formulario.jpg`. Isso disponibiliza o piloto para teste; não encerra o aceite A01–A24.

## Continuação em 02/11/2026

O usuário pediu continuar o desenvolvimento sem pausas. A interface administrativa de grants por processo foi implementada no workspace; o backend inclui grants no retorno de processos modeláveis, e a tela permite adicionar/remover modeler, publisher, operator e auditor, impede autoatribuição e usa `expectedVersion`. A atualização de grants sincroniza estado após conflito 409. A suíte frontend existente passou (20 testes) e o build passou; bundle de 506,85 KB excedeu o aviso de 500 KB. O teste dedicado de reidratação após 409 continua ausente. Esta interface ainda não foi atualizada no Axis local existente.

Na cópia PostgreSQL isolada `*_bpm_test`, a jornada foi ampliada para 10 testes passando. Evidência registrada pelo executor: A02 rejeita ciclo, nó desconhecido e approval/capacidade não suportada sem alterar versão/ponteiro; A03 comprova uma publicação vencedora e uma resposta 409 concorrente, preservando a versão vencedora; A06 verifica bytes/hash de PDF real, rejeição de MIME falso sem gravação e bloqueio de download sem vínculo; A08 confirma retry de criação com a mesma chave e 409 para corpo divergente; A14 oculta lista/detalhe/timeline/download para pessoa sem vínculo; A15 nega publicação sem grant mesmo com permissão global; A16 revalida permissão revogada diante da identidade antiga; A17 mantém v1 imutável e envia rascunho anterior à publicação de v2 usando o snapshot v1. Os 10 testes de jornada passaram na cópia local, e nenhum deles usou o banco Axis real. Relatos não substituem o quadro integral A01–A24: P01 continua aberto, P02 não liberado.
