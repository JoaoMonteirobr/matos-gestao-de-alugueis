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

## Limites da etapa

Não migramos contratos, pagamentos, autenticação, notificações nem toda a aplicação para TypeScript ou React. As próximas etapas devem migrar módulos isolados com testes, incluindo SQL/PostgreSQL quando houver ganho medido de desempenho. Qualquer alteração de RLS exige revisão de autorização separada.

## Segurança

O motor tipado recebe exclusivamente itens de busca já carregados pelo fluxo existente. Ele não conhece chaves do Supabase, não faz consultas de rede, não grava dados e não substitui as políticas RLS. A invalidação de dados ao encerrar/trocar de sessão continua a cargo de `global-search.js`.
