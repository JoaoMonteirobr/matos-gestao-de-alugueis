# Identidade visual da carteira imobiliária — Etapa 4

## Objetivo

As telas **Cadastros (imóveis)**, **Inquilinos** e **Contratos** adotam um padrão compartilhado, discreto e responsivo, em vez de criar três sistemas visuais independentes. A paleta segue a identidade Matos (azul profundo, cinzas neutros, superfícies claras e bordas suaves). A leitura e o funcionamento têm prioridade sobre efeitos gráficos.

## Componentes reutilizáveis

- `portfolio-ui.js` expõe `MatosPortfolioUI.statsHTML(items, title)` para indicadores numéricos com conteúdo escapado.
- `MatosPortfolioUI.filterHTML(id, placeholder, noun)` cria um controle local de pesquisa com rótulo e contador acessíveis.
- `MatosPortfolioUI.bindFilter(options)` aplica filtros somente nos registros já renderizados, inclusive no título do grupo de endereço, sem consultar ou alterar o banco.
- `portfolio-ui.css` concentra o sistema visual em seletores sob `.matos-portfolio` ou `#modal.matos-portfolio-dialog`, sem modificar o design de pagamentos, IPTU, relatórios ou autenticação.

Os controles de editar, excluir, anexar PDF, criar imóveis e cadastrar inquilinos continuam usando suas funções originais. O filtro oculta linhas no DOM: **não recria a tabela nem descarta os handlers de botões**.

## Segurança e autorização

As ações e linhas visíveis permanecem determinadas pelos fluxos legados, JWT e Supabase RLS. O componente não faz chamadas de rede, não armazena dados, não eleva permissões e não acessa tabelas sem autorização. O perfil de consulta não ganha botões de escrita. Textos exibidos nos indicadores são escapados, e métricas usam apenas números finitos.

## Acessibilidade e responsividade

Filtros têm rótulo, status `aria-live`, estados vazios e foco destacado. As tabelas preservam rolagem horizontal em celulares; os indicadores reorganizam-se em duas colunas. Os formulários móveis usam uma coluna e áreas de toque maiores. `prefers-reduced-motion` evita animações desnecessárias.

## Preparação para React

Estes elementos são uma **etapa de extração de responsabilidades**, não uma migração para React. Quando houver justificativa, cada componente poderá ser substituído separadamente por um componente React tipado sem refazer as chamadas Supabase, os formulários, as permissões ou a navegação. Nenhuma dependência ou bundler novo foi acrescentado nesta etapa.

## Validação e rollback

1. `npm ci && npm run quality && npm run build:cloudflare`.
2. Playwright (desktop e Pixel mobile) em Cadastros, Inquilinos e Contratos, incluindo pesquisa, PDF, abertura e fechamento dos formulários.
3. Preview READY no SHA do PR e CI verde antes de merge; confirmar a produção após integração.
4. Para reverter, reverter o PR: nenhum dado ou migração de banco está envolvido.
