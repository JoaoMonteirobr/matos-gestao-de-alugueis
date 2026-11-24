-- Otimização de índices de FKs da carteira Matos.
-- Migração aplicada no Supabase em 2026-11-24 (versão 20261124224228).
-- Não altera dados, permissões, RLS nem constraints.
-- Em tabelas pequenas o planejador pode preferir varredura sequencial.
CREATE INDEX IF NOT EXISTS idx_imoveis_proprietario_id ON public.imoveis USING btree (proprietario_id);
CREATE INDEX IF NOT EXISTS idx_contratos_imovel_id ON public.contratos USING btree (imovel_id);
CREATE INDEX IF NOT EXISTS idx_contratos_inquilino_id ON public.contratos USING btree (inquilino_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_imovel_id ON public.cobrancas USING btree (imovel_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_inquilino_id ON public.cobrancas USING btree (inquilino_id);
CREATE INDEX IF NOT EXISTS idx_manutencoes_imovel_id ON public.manutencoes USING btree (imovel_id);
CREATE INDEX IF NOT EXISTS idx_manutencoes_inquilino_id ON public.manutencoes USING btree (inquilino_id);
