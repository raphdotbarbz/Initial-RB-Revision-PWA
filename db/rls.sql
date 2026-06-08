alter table profiles enable row level security;
alter table user_snapshots enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles
  for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own"
  on profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own"
  on profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "snapshots_select_own" on user_snapshots;
create policy "snapshots_select_own"
  on user_snapshots
  for select
  using (auth.uid() = user_id);

drop policy if exists "snapshots_insert_own" on user_snapshots;
create policy "snapshots_insert_own"
  on user_snapshots
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "snapshots_update_own" on user_snapshots;
create policy "snapshots_update_own"
  on user_snapshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
