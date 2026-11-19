-- Push externo: credencial privada no Vault, fila de duração curta e execução autenticada.
-- Não altera contratos, aluguéis, pagamentos, IPTU nem comprovantes.
begin;

alter table public.push_fila
  add column if not exists proxima_tentativa_em timestamptz;

alter table public.push_dispositivos
  add column if not exists ultimo_teste_em timestamptz;

-- Não reutilizar notificações antigas; preserve o histórico e marque as
-- mensagens não entregues como expiradas (nunca como "enviadas").
update public.push_fila as f
set status='erro',
    ultimo_erro='Não entregue: aviso expirado, resolvido ou somente informativo',
    processando_em=null
from public.alertas as a
where f.alerta_id=a.id
  and f.status in ('pendente','enviando')
  and (f.created_at < now()-interval '24 hours' or a.resolvido or a.tipo='login');

-- A chave de 256 bits nasce no servidor e nunca é versionada ou retornada.
do $$
begin
  if not exists (select 1 from vault.secrets where name='push_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32),'hex'),
      'push_dispatch_secret',
      'Autenticação interna do pg_cron para envios da Casa Matos'
    );
  end if;
end $$;

-- A função roda como proprietário e somente service_role pode chamá-la.
-- O aplicativo público e os usuários autenticados não podem ler o Vault.
create or replace function public.validar_chave_dispatch_push(p_chave text)
returns boolean language sql stable security definer
set search_path=''
as $$
  select length(coalesce(p_chave,''))>=64
    and exists (
      select 1 from vault.decrypted_secrets
      where name='push_dispatch_secret' and decrypted_secret=p_chave
    );
$$;
revoke all on function public.validar_chave_dispatch_push(text) from public, anon, authenticated;
grant execute on function public.validar_chave_dispatch_push(text) to service_role;

-- Somente eventos operacionais acionam push remoto, não históricos de login.
create or replace function public.enfileirar_push_alerta()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.resolvido or new.tipo='login' then return new; end if;
  insert into public.push_fila (alerta_id,user_id,titulo,mensagem,url)
  select new.id,p.user_id,new.titulo,new.mensagem,'/?pagina=Alertas'
  from public.perfis p where p.role='admin'
  on conflict(alerta_id,user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.enfileirar_push_alerta() from public, anon, authenticated;

-- Capar o envio por ciclo e restringir a eventos atuais, não resolvidos.
-- Manter for update skip locked para evitar duplicação entre jobs.
create or replace function public.claim_push_fila(p_limit integer default 5)
returns setof public.push_fila
language plpgsql security definer
set search_path=''
as $$
begin
  return query
  with candidates as (
    select f.id
    from public.push_fila as f
    join public.alertas as a on a.id=f.alerta_id
    where f.tentativas < 5
      and f.created_at >= now()-interval '24 hours'
      and not a.resolvido
      and a.tipo <> 'login'
      and coalesce(f.proxima_tentativa_em,now())<=now()
      and (
        f.status='pendente'
        or (f.status='enviando' and f.processando_em < now()-interval '10 minutes')
      )
    order by case a.prioridade when 'urgente' then 0 when 'alta' then 1 else 2 end,
      f.created_at
    for update of f skip locked
    limit least(greatest(coalesce(p_limit,5),1),5)
  )
  update public.push_fila as f
  set status='enviando',tentativas=f.tentativas+1,processando_em=now()
  from candidates
  where f.id=candidates.id
  returning f.*;
end;
$$;
revoke all on function public.claim_push_fila(integer) from public, anon, authenticated;
grant execute on function public.claim_push_fila(integer) to service_role;

-- O agendador nunca faz chamadas sem a chave. O corpo não inclui dados sigilosos.
do $$
begin
  if exists (select 1 from cron.job where jobname='matos_push_dispatch') then
    perform cron.unschedule('matos_push_dispatch');
  end if;
  perform cron.schedule(
    'matos_push_dispatch','*/5 * * * *',
    $job$
    select net.http_post(
      url:='https://behmmbgbrsesxthsczdl.supabase.co/functions/v1/push-dispatch',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-push-dispatch-secret',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='push_dispatch_secret'
          limit 1
        )
      ),
      body:='{}'::jsonb
    )
    where exists(select 1 from vault.decrypted_secrets where name='push_dispatch_secret');
    $job$
  );
end $$;
commit;
