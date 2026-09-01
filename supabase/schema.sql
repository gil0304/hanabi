-- デジタル花火大会 Supabase スキーマ
-- Supabase ダッシュボードの SQL Editor に貼り付けて実行する。

create table if not exists public.fireworks (
  id uuid primary key default gen_random_uuid(),
  drawing_data jsonb not null,
  message text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'approved',
  shown_count int not null default 0,
  last_shown_at timestamptz
);

create table if not exists public.screen_settings (
  id int primary key,
  data jsonb not null
);

-- Realtime 配信対象に追加
alter publication supabase_realtime add table public.fireworks;
alter publication supabase_realtime add table public.screen_settings;

-- RLS
alter table public.fireworks enable row level security;
alter table public.screen_settings enable row level security;

-- 注意: 以下のポリシーは「会場ローカルの1夜イベント」向けの簡易設定で、
-- anon キーを持つ誰でも全操作 (管理操作含む) が可能になる。
-- 公開デプロイする場合は select を status='approved' に絞り、
-- update/delete は service_role か認証済み管理者のみに締めること。
create policy "event_mode_all_fireworks"
  on public.fireworks
  for all
  to anon
  using (true)
  with check (true);

create policy "event_mode_all_screen_settings"
  on public.screen_settings
  for all
  to anon
  using (true)
  with check (true);

-- 初期設定行 (無くてもアプリ側が自動作成する)
insert into public.screen_settings (id, data)
values (
  1,
  '{
    "fireworkInterval": 2.5,
    "concurrentFireworks": 2,
    "messageVisible": true,
    "soundVolume": 0.8,
    "backgroundMode": "festival",
    "qrVisible": true
  }'::jsonb
)
on conflict (id) do nothing;
