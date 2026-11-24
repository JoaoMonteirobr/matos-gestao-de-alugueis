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

## Primeira ilha React: indicadores da tela Cadastros

A modernização já começou, de forma isolada. O componente TSX `src/react/portfolio-stats.tsx` monta com `React 19` e `react-dom/client.createRoot` **somente os quatro indicadores de imóveis**, sem assumir o restante da página.

- O JavaScript continua servido localmente em `portfolio-react.js`, pré-compilado pelo esbuild com JSX automático, versionado no Git e servido pela Vercel e Cloudflare. **Não há importação de React por CDN.**
- A tela Cadastros prepara os mesmos dados e o HTML original com `MatosPortfolioUI.statsHTML`. Se o bundle opcional falhar, os cartões legados continuam visíveis.
- Se React estiver disponível, `window.MatosReactPortfolio.mountStats` substitui apenas o conteúdo dos quatro cartões. Os agrupamentos, filtros, botões, formulários e PDFs permanecem controlados pelo código existente.
- Há um `MutationObserver` para desmontar a ilha quando o container sai do DOM; reabrir Cadastros cria uma nova raiz. O componente não recebe tokens, CPF, contratos, dados bancários nem acesso ao Supabase.
- O bundle é gerado por `npm run build:react`. Sempre que alterar o TSX, execute esse comando e versione o arquivo gerado; `npm run verify:react-build` impede divergências no CI.
- `npm run typecheck` valida tanto o motor de Busca global quanto a ilha React estritamente, via `tsconfig.react.json`.

A adoção das próximas ilhas (por exemplo, filtros ou listas) depende de testes funcionais e de evidência de benefício, sem reescrever a aplicação.

## Segunda ilha React: filtro local de imóveis

O filtro da tela **Cadastros** agora também é uma pequena ilha React, sem modificar o conteúdo ou a propriedade da tabela de imóveis. O componente `PortfolioFilter` gerencia apenas campo de pesquisa, texto do contador e atualização do valor. O código legado continua responsável pela seleção das linhas, grupos por endereço e estado de nenhum resultado.

- `MatosPortfolioUI.filterRows(options, query)` é a lógica de filtragem compartilhada e devolve `{ visible, total }`. Ela não faz consultas Supabase nem altera registros.
- A interface React chama essa função quando o usuário digita. Continua ignorando acentos, incluindo nomes de unidades, inquilinos e endereços do agrupamento.
- Na ausência de React, `MatosPortfolioUI.bindFilter(options)` instala o evento original no input HTML já presente. O filtro e os indicadores continuam úteis sem o bundle.
- O contador recebe atualização pelo estado do React; o aviso de busca sem resultados continua acessível na tela.
- Ao sair de Cadastros, um observador desmonta tanto os indicadores quanto o filtro. Ao reabrir, ambos começam com valores limpos, sem guardar uma pesquisa anterior.
- Apenas a tela Cadastros é afetada. Contratos e Inquilinos continuam usando seus componentes de busca anteriores.

O bundle React local é atualizado junto com o código TSX; `verify:react-build` impede alterações não versionadas. A integração não recebe token de autenticação, não consulta APIs e não modifica o acesso a PDFs e contratos.

## Validação e rollback

1. `npm ci && npm run quality && npm run build:cloudflare` (incluindo React e build reproduzível).
2. Playwright (desktop e Pixel mobile) em Cadastros, Inquilinos e Contratos, incluindo pesquisa, PDF, abertura e fechamento dos formulários.
3. Preview READY no SHA do PR e CI verde antes de merge; confirmar a produção após integração.
4. Para reverter, reverter o PR: nenhum dado ou migração de banco está envolvido.
