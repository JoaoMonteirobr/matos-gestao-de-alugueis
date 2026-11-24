# Otimização de consultas — Matos (novembro de 2026)

## Diagnóstico antes da alteração

A Busca global usa requisições REST somente de leitura com JWT da sessão e políticas RLS para `imoveis`, `inquilinos`, `contratos`, `cobrancas` e `manutencoes`. Os registros são carregados em blocos de 500, com cache apenas na memória do navegador e invalidado por identidade de sessão.

O advisor de desempenho do Supabase apontou **21 chaves estrangeiras sem índice** no projeto, sendo sete dos relacionamentos contemplados neste trabalho. A coluna `imoveis.inquilino_id` já tem índice; `cobrancas.contrato_id` já é coberta por índices únicos compostos. Não duplicar esses índices.

As tabelas possuem poucos registros (a estimativa do planejador para `cobrancas` era 231 linhas; outras tabelas não estavam analisadas). Portanto, o PostgreSQL ainda pode escolher varredura sequencial em vez de um índice. A melhoria busca escalabilidade dos filtros e dos testes de vínculo de RLS, sem prometer aceleração imediata.

O plano de referência, `EXPLAIN (ANALYZE, BUFFERS)`, de consulta por competência em `cobrancas` mostrou execução de aproximadamente 1,255 ms e uso de um índice composto já existente. Por isso não adicionamos outro índice em `competencia`.

## Escopo de índices

Criar índices B-tree idempotentes para sete chaves:
- `imoveis(proprietario_id)` — filtro por carteira/proprietário
- `contratos(imovel_id)` e `contratos(inquilino_id)`
- `cobrancas(imovel_id)` e `cobrancas(inquilino_id)`
- `manutencoes(imovel_id)` e `manutencoes(inquilino_id)`

Nenhum índice exclusivo, regra de integridade ou política RLS será removido/modificado. Índices têm custo extra de escrita e ocupam espaço, que deve ser acompanhado caso o volume cresça.

## Busca global

A ordenação REST passa a ser `created_at.desc,id.desc`, reduzindo a ambiguidade de páginas quando vários registros possuem o mesmo timestamp. Isso **não** equivale a paginação por cursor: novas inclusões durante as páginas ainda podem mover deslocamentos. A próxima etapa poderá adotar paginação por cursor mediante evidência de volume ou duplicações.

## Resultado da aplicação no Supabase

- Migração registrada como `20261124224228_indexar_relacionamentos_carteira_matos`, versionada em `supabase/migrations/`.
- Os sete índices aparecem em `pg_indexes` com as colunas previstas.
- O aviso `unindexed_foreign_keys` do Supabase caiu de **21 para 14 ocorrências**; nenhuma das sete chaves deste escopo continua sem índice.
- Contagem de registros antes e depois: 21 imóveis, 21 inquilinos, 1 contrato, 231 cobranças e 0 chamados. Nenhuma mudança de contagem.
- Não é possível inferir aceleração imediata com base apenas na queda de avisos; os planos devem ser reavaliados quando o volume aumentar.

## Validação

1. Conferir o deploy do PR, typecheck, testes unitários, Playwright desktop/mobile e build Cloudflare.
2. Aplicar a migração idempotente no projeto `behmmbgbrsesxthsczdl` após revisão, verificando sete índices em `pg_indexes`.
3. Conferir novamente os advisors de desempenho/segurança e os planos de consulta, sem desligar RLS em produção.
4. Conferir o domínio oficial após merge.
5. Monitorar o crescimento da carteira antes de propor mais índices.

## Reversão

Para voltar ao plano anterior, reverter o PR de frontend. Se necessário reverter o esquema, remover **apenas** os sete índices deste trabalho usando `DROP INDEX IF EXISTS public.<nome>`, em janela de manutenção. Não apagar tabelas nem registros. A remoção de índices pode piorar o desempenho em consultas que já passaram a depender deles, por isso deve ser avaliada com `EXPLAIN`.

## Segurança

Não há consulta de PII nos testes do banco: foram lidos apenas metadados de índices e planos de execução. A pesquisa continua respeitando o token do usuário e políticas Supabase já existentes.