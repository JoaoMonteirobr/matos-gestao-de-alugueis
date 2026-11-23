import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const migration = read('supabase/migrations/20261120_telegram_canal_piloto.sql');
const functionCode = read('supabase/functions/telegram-channel/index.ts');
const client = read('telegram-integration.js');
const ui = read('alerts.js');
const html = read('index.html');
const css = read('telegram-ui.css');

describe('Telegram opcional como canal externo de alertas', () => {
  it('segredos somente em Vault e Edge, sem tokens versionados', () => {
    expect(migration).toContain("vault.create_secret(");
    expect(migration).toContain("encode(extensions.gen_random_bytes(32),'hex')");
    expect(migration).toContain("name='matos_telegram_dispatch_secret'");
    expect(functionCode).toContain("Deno.env.get('MATOS_TELEGRAM_BOT_TOKEN')");
    expect(functionCode).toContain("db.rpc('validar_chave_telegram_dispatch'");
    expect(functionCode).toContain("req.headers.get('x-matos-telegram-secret')");
    expect(functionCode).toContain('const auth = await requireAdmin(req)');
    expect(functionCode).toContain('return adminAction(req, body)');
    expect(functionCode).toContain("if (body.action === 'dispatch') return internalDispatch(req)");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.validar_chave_telegram_dispatch(text) TO service_role');
    expect(migration).not.toMatch(/bot\d{6,16}:[A-Za-z0-9_-]{25,}/);
  });
  it('RLS e tabelas privadas sem acesso a anon ou authenticated', () => {
    for (const table of ['telegram_vinculos', 'telegram_pareamentos', 'telegram_fila']) {
      expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.' + table);
      expect(migration).toContain('ALTER TABLE public.' + table + ' ENABLE ROW LEVEL SECURITY');
    }
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(migration).toContain('UNIQUE(alerta_id,user_id)');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.claim_telegram_fila(integer)');
  });
  it('mantém desligado por padrão e não cria mensagens de login ou backlog', () => {
    expect(migration).toContain('ativo boolean NOT NULL DEFAULT false');
    expect(migration).toContain("IF NEW.tipo='login' OR NEW.resolvido THEN RETURN NEW");
    expect(migration).toContain('AFTER INSERT ON public.alertas');
    expect(migration).toContain("ON CONFLICT(alerta_id,user_id) DO NOTHING");
    expect(migration).toContain("f.created_at < now()-interval '24 hours'");
    expect(migration).toContain('FOR UPDATE OF f SKIP LOCKED');
    expect(migration).toContain("'matos_telegram_dispatch','* * * * *'");
    expect(migration).toContain('WHERE ativo=true');
    expect(migration).not.toMatch(/(?:DELETE|TRUNCATE)\s+(?:FROM\s+)?public\.alertas/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.(?:imoveis|iptu|cobrancas|contratos)/i);
  });
  it('pareamento deve ser aleatório, curto, privado e vinculado ao administrador', () => {
    expect(functionCode).toContain('crypto.getRandomValues(new Uint8Array(24))');
    expect(functionCode).toContain("await sha256(code)");
    expect(functionCode).toContain("Date.now() + 15 * 60 * 1000");
    expect(functionCode).toContain('privateChatId(msg?.chat)');
    expect(functionCode).toContain("info.type !== 'private'");
    expect(functionCode).toContain(".eq('user_id', userId).eq('code_hash', hash)");
    expect(functionCode).toContain("link: 'https://t.me/' + username + '?start=' + code");
    expect(functionCode).toContain("action === 'verify'");
    expect(functionCode).toContain('getUpdates');
    expect(functionCode).not.toContain('setWebhook');
  });
  it('teste é manual e ativação requer teste realizado', () => {
    expect(functionCode).toContain("action === 'test'");
    expect(functionCode).toContain("action === 'enable' || action === 'disable'");
    expect(functionCode).toContain("'test_required'");
    expect(functionCode).toContain('ultimo_teste_em');
    expect(functionCode).toContain('test_cooldown');
    expect(functionCode).toContain("action === 'disconnect'");
    expect(client).toContain('Recebi o teste — ativar avisos');
    expect(client).toContain('Enviar mensagem de teste');
    expect(client).toContain("await callTelegram('enable')");
    expect(client).toContain("await callTelegram('disable')");
  });
  it('mensagens automáticas não expõem detalhes privados', () => {
    const format = functionCode.slice(functionCode.indexOf("const message = alert.data.tipo==='login'"),
      functionCode.indexOf("telegramFailure = await sendMessage", functionCode.indexOf("const message = alert.data.tipo==='login'")));
    expect(format).toContain('category(alert.data.tipo)');
    expect(format).toContain('Prioridade');
    expect(format).not.toContain('item.mensagem');
    expect(functionCode).toContain('consulte a Casa Matos'.replace('consulte','Consulte'));
  });
  it('interface web responsiva, opcional e sem alterar push atual', () => {
    expect(html).toContain('/telegram-integration.js?v=3');
    expect(html).toContain('/telegram-ui.css?v=2');
    expect(css).toContain('@media(max-width:640px)');
    expect(ui).toContain("window.matosTelegramPanel?window.matosTelegramPanel():'')");
    expect(ui).toContain('window.matosTelegramMount');
    expect(ui).toContain('pushPanel()');
    expect(client).toContain('MATOS_TELEGRAM_BOT_TOKEN');
    expect(client).toContain('https://t.me/BotFather');
    expect(client).toContain('sessionStorage.setItem(ID,result.code)');
  });
});
