# Migração gradual para TypeScript

## Etapa 1 — Busca global

Esta etapa introduz um módulo de lógica pura com tipos explícitos em `src/search/search-engine.ts`. O código gerado é `search-engine.js`, carregado no navegador antes de `global-search.js`. A tela, a autenticação e as consultas Supabase continuam no JavaScript existente. Não há migração de banco ou mudança no comportamento de pagamentos.

O Matos continua sendo um site estático e **não precisa de um bundler em produção**. O JavaScript compilado é versionado para ser servido pela Vercel e pela Cloudflare, enquanto o TypeScript é checado durante o desenvolvimento.

## Comandos

- `npm ci`: instalar exatamente as versões do lockfile.
- `npm run typecheck`: análise estática estrita do TypeScript.
- `npm run build:search`: compilar o módulo para `search-engine.js`.
- `npm run verify:search-build`: compilar e verificar que o arquivo gerado versionado corresponde ao código TypeScript.
- `npm run test`: executar os testes.
- `npm run quality`: passar todos os gates locais.

Ao modificar `src/search/search-engine.ts`, execute `npm run build:search` e inclua o `search-engine.js` gerado no mesmo PR. Nunca edite manualmente a versão compilada.

## Etapa 2 — Modelos de domínio e vínculos

As interfaces \`PropertyRecord\`, \`TenantRecord\`, \`ContractRecord\`, \`ChargeRecord\` e \`MaintenanceRecord\` são usadas no motor TypeScript em \`src/search/search-engine.ts\`. Correspondem aos campos de leitura da Busca global e permitem valores nulos para associações opcionais; não substituem validação de dados nem políticas RLS do banco.

A função \`linkCatalog\` organiza os registros já autorizados em mapas por identificador e cria um vínculo de consulta para inquilinos. Sua ordem de preferência segue a regra preexistente: imóvel com \`inquilino_id\` associado diretamente e, quando ausente, primeiro contrato correspondente. Isso elimina pesquisas repetidas em listas grandes durante a montagem dos resultados.

A interface continua usando \`global-search.js\` para carregamento por JWT/RLS, cache isolado por sessão, HTML escapado e navegação conforme o menu autorizado. Nenhum dado é modificado ou persistido pelo mecanismo tipado.

As futuras migrações devem extrair operações de cadastro e validação para funções puras antes de modificar formulários e ações de escrita. Não confundir interfaces TypeScript com garantias de integridade: permissões continuam sendo verificadas no Supabase.

## Limites da etapa

Não migramos contratos, pagamentos, autenticação, notificações nem toda a aplicação para TypeScript ou React. As próximas etapas devem migrar módulos isolados com testes, incluindo SQL/PostgreSQL quando houver ganho medido de desempenho. Qualquer alteração de RLS exige revisão de autorização separada.

## Segurança

O motor tipado recebe exclusivamente itens de busca já carregados pelo fluxo existente. Ele não conhece chaves do Supabase, não faz consultas de rede, não grava dados e não substitui as políticas RLS. A invalidação de dados ao encerrar/trocar de sessão continua a cargo de `global-search.js`.
