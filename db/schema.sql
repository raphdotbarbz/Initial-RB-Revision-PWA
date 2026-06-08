create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key,
  email text unique,
  display_name text,
  exam_track text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_snapshots (
  user_id uuid primary key references profiles(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists modules (
  key text primary key,
  title text not null,
  sort_order int not null default 0
);

create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  module_key text not null references modules(key) on delete cascade,
  curriculum_module text,
  topic text,
  subtopic text,
  title text not null,
  source_kind text not null default 'manual',
  source_ref text,
  status text not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  module_key text not null references modules(key) on delete cascade,
  type text not null,
  topic text,
  subtopic text,
  curriculum_module text,
  difficulty text,
  level text,
  stem text not null,
  options jsonb,
  answer jsonb,
  explanation text,
  formula_ref text,
  tolerance_pct numeric,
  source_kind text not null default 'seed',
  source_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists flashcards (
  id text primary key,
  module_key text not null references modules(key) on delete cascade,
  topic text,
  subtopic text,
  curriculum_module text,
  level text,
  front text not null,
  back text not null,
  uncertain boolean not null default false,
  source_kind text not null default 'seed',
  source_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  correct boolean not null,
  skipped boolean not null default false,
  elapsed_sec int not null default 0,
  answer_payload jsonb,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_question_attempts_user_module_date
  on question_attempts (user_id, module_key, attempted_at desc);

create table if not exists flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  flashcard_id text not null references flashcards(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  rating int not null check (rating between 1 and 5),
  reviewed_at timestamptz not null default now()
);

create index if not exists idx_flashcard_reviews_user_module_date
  on flashcard_reviews (user_id, module_key, reviewed_at desc);

create table if not exists user_question_state (
  user_id uuid not null references profiles(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  flagged boolean not null default false,
  correct_count int not null default 0,
  attempt_count int not null default 0,
  last_seen_at timestamptz,
  primary key (user_id, question_id)
);

create table if not exists user_flashcard_state (
  user_id uuid not null references profiles(id) on delete cascade,
  flashcard_id text not null references flashcards(id) on delete cascade,
  review_count int not null default 0,
  confidence_sum int not null default 0,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  last_rating int check (last_rating between 1 and 5),
  last_seen_at timestamptz,
  primary key (user_id, flashcard_id)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  goal_type text not null check (goal_type in ('daily_questions', 'daily_items', 'total_questions')),
  target_value int not null check (target_value >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module_key, goal_type)
);

create table if not exists ai_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  module_key text references modules(key) on delete set null,
  question_id text references questions(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references ai_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_messages_thread_created
  on ai_messages (thread_id, created_at asc);

create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  module_key text references modules(key) on delete set null,
  import_kind text not null,
  filename text,
  status text not null default 'queued',
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
