# Matos — cópia de testes para Cloudflare Pages

**Esta branch é independente da produção da Vercel. Não fazer merge em `main` para publicar a cópia.**

## Configuração no Cloudflare Pages

1. Entre em https://dash.cloudflare.com/ e abra **Workers & Pages**.
2. Crie um projeto **Pages**, escolha **Conectar ao Git** e autorize o repositório `JoaoMonteirobr/matos-gestao-de-alugueis`.
3. Configure uma nova hospedagem Cloudflare (não altere nenhum projeto Vercel):
   - Nome sugerido: `matos-cloudflare-teste` (a Cloudflare poderá solicitar outro se já existir).
   - Branch de produção do projeto Pages: `cloudflare-teste`.
   - Diretório raiz: `/` (raiz do repositório).
   - Framework: `None` / nenhum.
   - Build command: `node scripts/build-cloudflare.mjs`
   - Build output directory: `dist`
   - Versão do Node: `22` (definir `NODE_VERSION=22` se necessário).
4. Publique e copie o endereço **exato** fornecido pela Cloudflare, terminado em `.pages.dev`.

## Antes de usar o login no novo domínio

A interface estática será publicada, mas o Supabase utiliza restrições de origem e configurações de redirecionamento. **Sem autorizar o domínio real recém-criado, login e Edge Functions podem falhar por CORS.**

- Adicionar o domínio Cloudflare à variável `ALLOWED_ORIGINS` das Edge Functions no projeto Supabase, preservando o domínio Vercel existente.
- Incluir o domínio em **Supabase Authentication → URL Configuration → Redirect URLs**, conforme os fluxos de recuperação de senha e redirecionamento que estiverem habilitados.
- Verificar regras de domínio da configuração pública do Firebase e registro do service worker `/sw.js` para push web.
- As Edge Functions que formam links para notificações push e Telegram ainda têm o domínio Vercel fixado. Atualizá-las com uma política de URL por ambiente, de forma que os dois sites coexistam; não substituir silenciosamente o destino usado pelos usuários da produção.
- Executar os testes de login, senha, perfis e permissões, listagens, PDFs e notificações em desktop e Android antes de considerar a cópia pronta.

## Dados compartilhados: atenção

Este é **um segundo frontend** para o **mesmo backend Supabase**; os dados de imóveis, inquilinos, pagamentos e autenticação são os mesmos. Qualquer alteração real feita na cópia aparecerá também na produção da Vercel. Não usar para inserir dados fictícios sem criar uma base Supabase de homologação separada.

## Segurança

A compilação copia apenas os arquivos públicos de interface para `dist/`. Não inclui `supabase/`, `tests/`, `scripts/`, `package.json`, documentação interna ou migrações. Nunca publicar a raiz completa do repositório como diretório de saída da Cloudflare.

## Publicação original

Permanece em https://gestao-alugueis-jp.vercel.app, branch `main`.
