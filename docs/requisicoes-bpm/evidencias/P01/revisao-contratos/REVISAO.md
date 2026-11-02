# Contrato corrigido e preparação de atualização — 02/11/2026

**19 testes DOM e 47 testes de backend confirmados independentemente**, todos passando. Logs neste diretório. O produtor discriminado `commands.ts` é usado pela tela e validado contra os DTOs reais; a falha HTTP da revisão anterior foi corrigida. A tela também distingue rejeição definitiva, conflito e tentativa de rede ambígua.

Não há aceite integral de P01. A entrega ampliou transações, política, administração e migration; esses blocos ainda exigem validação integrada. Foram encaminhadas a preservação da máscara de leitura após o fim da atividade e a repetição da criação v1 após publicação v2, que deve consultar receipt sem exigir que v1 continue sendo o ponteiro vigente.

## Ambiente existente localizado

A checagem Windows estava limitada pelo sandbox. Com consulta autorizada fora dele, o Ubuntu/WSL2 revelou o Docker existente e os serviços Axis ativos nas portas 5173/3000/5432. O diretório de Compose corresponde a este workspace. A informação anterior de serviços desligados foi corrigida ao usuário.

O usuário autorizou colocar a implementação no ambiente existente. O chat de implementação será o único executor: preservar imagens anteriores, backup consistente no volume privado existente, ensaio da migration/testes em cópia descartável, atualização aditiva e reinício somente de backend/frontend necessários. Sem reset, seed operacional, remoção de dados/volumes ou alterações no satélite. As migrations preexistentes de responsável do CC e approvalSource já constam aplicadas no banco.

O resultado da implantação, do ensaio PostgreSQL e do smoke HTTP será registrado após execução. Esta revisão não afirma que a versão nova já está disponível.

## Resultado posterior

O implementador concluiu a atualização e registrou 20 testes DOM, 48 backend e 4 PostgreSQL reais passando. Sol confirmou em leitura a migration P01 concluída, os containers novos e a rota BPM respondendo 401 sem autenticação. Na sessão já autenticada, confirmou portal antigo, menu do piloto, catálogo com Solicitação piloto BPM e campos de observação, quantidade e urgência da v2. O anexo fica disponível após salvar o rascunho, conforme a tela informa. Não houve criação de requisição por Sol. Evidência visual: `piloto-formulario.jpg`. Backup, imagens de rollback e comando de subida estão em `../DEPLOY-PILOTO-EXISTENTE.md`. O aceite integral de P01 permanece aberto.
