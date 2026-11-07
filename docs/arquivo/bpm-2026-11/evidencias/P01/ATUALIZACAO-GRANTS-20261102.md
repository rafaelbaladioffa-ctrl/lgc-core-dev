# Atualização incremental do piloto: grants UI/API — 2026-11-02

## Resultado

Atualização aplicada ao Axis local para publicar a interface de grupos e permissões e os endpoints de leitura/gravação de grants. Não houve migration, seed, reset, gravação de grants, alteração de permissão de conta existente, nem ação sobre volumes ou satélite. O deploy recriou apenas backend e frontend.

## Validação antes da atualização

- Frontend: `npm run build` passou; `npm run test:journey` passou com **20 testes**.
- Backend: imagem Docker de build passou; `src/request-runtime/p01-regression.spec.ts` passou com **14 testes**; PostgreSQL BPM passou com **10 testes** (8 jornada + 2 persistência) no banco descartável `_bpm_test`.
- Build frontend no Docker também passou. O Vite reportou o aviso já conhecido: bundle principal de 508,80 kB e import dinâmico inefetivo de `BpmPages.tsx`.
- O `nest build` executado diretamente no Windows recebeu `EPERM` ao acessar `backend/dist`; a validação final de build backend foi concluída no Docker, que é o runtime do piloto.

## Proteções e rollback registrados antes do deploy

- Dump PostgreSQL consistente no volume privado `axis_backups`: `/backups/axis_p01_grants_20261102T100500Z.dump`.
- Dump validado com `pg_restore --list`, permissão `600`; SHA-256: `c98682d5d51ebd9d9edce7e4dff439213220e8a23492a3d197c5dc36561fb502`.
- Imagens de rollback criadas a partir do filesystem dos containers que estavam ativos (o Docker local indicou ausência dos content digests das referências antigas para `docker tag`/`docker commit`):
  - `lgc-dev-core-backend:rollback-p01-grants-20261102` — `sha256:79e9e9c630875f94e0d716aedf1008d0ac62551301cd4321a744dab9a58bdea5`, `WORKDIR /app`, `CMD node dist/main.js`.
  - `lgc-dev-core-frontend:rollback-p01-grants-20261102` — `sha256:106b8ea5ee61974bbf968a956dcb7ba62dd2e1f39fe6ac09ebb892a33c4c13f3`, `CMD nginx -g 'daemon off;'`.

## Deploy executado

Build final:

```sh
docker compose -f docker-compose.yml -f docker-compose.p01.override.yml build backend frontend
```

Recriação limitada aos dois serviços, sem migration/seed:

```sh
docker compose -f docker-compose.yml -f docker-compose.p01.override.yml up -d --no-deps --force-recreate backend frontend
```

O override manteve o comando `node dist/main.js`. Backend, frontend, PostgreSQL e backup estão `running` após a atualização.

## Smoke autenticado pós-deploy

Executado por HTTP autenticado na rede Docker, apenas com login e leituras GET. A senha foi lida localmente de `backend/.env`, montada como arquivo somente leitura e não registrada na saída. O acesso interativo CUA ao Firefox expirou em revisão automática; foi usada a validação HTTP autenticada prevista como alternativa, sem novo pedido de navegador.

Saída do smoke (`smoke-grants.mjs`):

```json
{
  "login": 200,
  "adminMenuVisible": true,
  "rolesLoaded": 8,
  "grantsLoaded": 56,
  "bpmEnabled": true,
  "processesLoaded": 2,
  "oldUiRoute": 200,
  "grantsUiRoute": 200,
  "oldApiRoute": 200
}
```

Rotas verificadas: UI `/requests` e `/roles`; API autenticada `/roles`, `/roles/permissions`, `/bpm/capabilities`, `/bpm/processes` e `/requests/mine`. O smoke não envia nem salva grants.

## Rollback de aplicação

```sh
docker tag lgc-dev-core-backend:rollback-p01-grants-20261102 lgc-dev-core-backend:latest
docker tag lgc-dev-core-frontend:rollback-p01-grants-20261102 lgc-dev-core-frontend:latest
docker compose -f docker-compose.yml -f docker-compose.p01.override.yml up -d --no-deps --force-recreate backend frontend
```

O backup do banco fica preservado no volume privado. Como esta atualização não aplicou migration nem escreveu grants, o rollback da aplicação não requer restaurar o banco.

## Acesso para testar

- Piloto: [http://localhost:5173/requests/bpm](http://localhost:5173/requests/bpm)
- Grupos e permissões: [http://localhost:5173/roles](http://localhost:5173/roles)
