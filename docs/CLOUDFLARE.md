# Segunda hospedagem na Cloudflare Pages

O Matos pode publicar o mesmo frontend estático na Vercel e na Cloudflare Pages.
As duas hospedagens usam o Supabase existente: cadastros, pagamentos e arquivos
continuam compartilhados. Esta configuração não cria um backup independente do banco.

## Preparação

```sh
npm run build:cloudflare
```

O comando usa apenas Node.js e gera `dist/` com a lista explícita de arquivos de
`cloudflare/public-assets.json`. Não publique a raiz do repositório: ela contém
testes, migrations, ferramentas de desenvolvimento e documentação interna.
Ao adicionar um asset de execução, inclua-o nessa lista pelo fluxo de Issue/PR.
O build verifica os assets referenciados pelo HTML e os ícones do manifesto.
As bibliotecas PDF e o service worker também fazem parte do pacote público.

## Campos do projeto Pages

| Campo | Valor |
| --- | --- |
| Repositório | `JoaoMonteirobr/matos-gestao-de-alugueis` |
| Branch de produção | `main`, após a validação do PR |
| Framework preset | `None` |
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist` |
| Root directory | raiz do repositório, deixar em branco |
| `NODE_VERSION` | `22` |
| `SKIP_DEPENDENCY_INSTALL` | `1` |

O build não precisa das dependências de desenvolvimento. Não informe comando de
deploy de Workers: esta configuração é de **Pages**. Para upload manual, envie
somente `dist/` depois do build. Mantenha o projeto, domínio e configurações da
Vercel. Não altere nameservers nem DNS para usar o endereço `pages.dev` atribuído.

## Integrações depois de confirmar o domínio

O domínio definitivo só deve ser registrado após aparecer na conta Cloudflare.
Não autorize `*.pages.dev`, que também incluiria projetos de outras pessoas.

1. Acrescente a **origem HTTPS exata**, sem caminho ou barra final, a
   `ALLOWED_ORIGINS` nas Edge Functions do Supabase. Preserve todos os valores
   existentes. Os helpers de CORS aceitam essa configuração; sem ela, o navegador
   bloqueará o login seguro e outras operações da cópia.
2. Confirme CORS por `OPTIONS` para `secure-login`, `admin-create-user`,
   `push-dispatch`, `telegram-channel` e `whatsapp-send`. A origem permitida deve
   receber `Access-Control-Allow-Origin` com seu valor exato. Uma origem não
   autorizada deve continuar sem esse cabeçalho.
3. O frontend solicita recuperação usando a constante `SITE`, atualmente apontada
   para a Vercel. A recuperação pode continuar terminando nesse domínio. Para
   terminar na cópia, primeiro registre a URL exata em Supabase Auth / URL
   Configuration / Redirect URLs e ajuste o frontend em um PR próprio. Preserve
   a URL principal e as permissões exclusivas do superadministrador.
4. As permissões de notificações, tokens push, sessões e instalação PWA pertencem
   à origem. Autorize e teste o push no novo endereço. Confira eventuais restrições
   de referenciador da chave pública Firebase. Nunca envie credenciais de servidor
   para a Cloudflare ou para arquivos do frontend.
5. Links absolutos enviados pelo Telegram e pelo push continuam na Vercel. Não
   duplique crons, filas nem rotinas automáticas para criar a segunda hospedagem.

## Aceite e validação

- Execute os gates do repositório e o build em uma branch de tarefa.
- Valide o Preview da Vercel antes do merge, quando disponível.
- Na Cloudflare, confirme HTTPS, carregamento em desktop/mobile e ausência de
  erros de script ou CORS. Verifique login, perfis, dashboard e relatórios PDF.
- Confirme que `/supabase/config.toml`, migrations, testes e `package.json` não
  retornam seu conteúdo original. Pages pode retornar o HTML da aplicação como
  fallback; isso não significa que esses arquivos estão publicados.
- Confira cadastro/consulta conforme o perfil, anexos privados e notificações.
  Não crie pagamentos reais ou outros dados operacionais só para testar.
- Verifique que a Vercel continua acessível pelo endereço anterior.

Não considerar a segunda hospedagem concluída antes de validar as integrações no
domínio definitivo. Manter a Issue #117 aberta se houver pendências de acesso,
publicação ou validação.

## Referências

- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://supabase.com/docs/guides/auth/redirect-urls
