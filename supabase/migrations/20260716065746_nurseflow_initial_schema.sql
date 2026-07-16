-- NurseFlow AI initial schema.
-- Target: Supabase Postgres 17. All application data is nickname-only and
-- department-scoped. This migration intentionally opts in to explicit Data API
-- grants and does not grant any application table access to anon.

create schema if not exists nurseflow_private;

revoke all on schema nurseflow_private from public, anon, authenticated, service_role;

-- Supabase is moving new projects to explicit Data API exposure. Adopt that
-- behavior now so later tables/functions are private until deliberately granted.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  timezone text not null default 'Asia/Bangkok',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint departments_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint departments_name_not_blank check (char_length(btrim(name)) between 1 and 120),
  constraint departments_timezone_not_blank check (char_length(btrim(timezone)) between 1 and 80),
  constraint departments_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.department_memberships (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_nickname text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint department_memberships_role_valid check (role in ('ADMIN', 'SCHEDULER', 'REVIEWER', 'VIEWER')),
  constraint department_memberships_nickname_not_blank check (
    char_length(btrim(member_nickname)) between 1 and 80
  ),
  constraint department_memberships_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.skill_levels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null,
  name text not null,
  sort_order smallint not null,
  is_incharge_capable boolean not null default false,
  is_trainee boolean not null default false,
  is_emergency_only boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint skill_levels_code_format check (code ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'),
  constraint skill_levels_name_not_blank check (char_length(btrim(name)) between 1 and 100),
  constraint skill_levels_sort_order_positive check (sort_order > 0),
  constraint skill_levels_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.shift_types (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null,
  name text not null,
  category text not null,
  hours numeric(5,2) not null default 0,
  is_working_shift boolean not null default false,
  is_locked_request boolean not null default false,
  sort_order smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint shift_types_code_format check (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  constraint shift_types_name_not_blank check (char_length(btrim(name)) between 1 and 100),
  constraint shift_types_category_valid check (category in ('WORK', 'OFF', 'LEAVE', 'EDUCATION')),
  constraint shift_types_hours_valid check (hours between 0 and 24),
  constraint shift_types_sort_order_positive check (sort_order > 0),
  constraint shift_types_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  skill_level_id uuid not null,
  nickname text not null,
  employment_status text not null default 'ACTIVE',
  max_monthly_clinical_shifts smallint,
  effective_start_date date,
  effective_end_date date,
  is_synthetic boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint employees_skill_level_fk foreign key (skill_level_id, department_id)
    references public.skill_levels(id, department_id) on delete restrict,
  constraint employees_nickname_not_blank check (char_length(btrim(nickname)) between 1 and 80),
  constraint employees_status_valid check (employment_status in ('ACTIVE', 'INACTIVE', 'ON_LEAVE')),
  constraint employees_max_shifts_valid check (
    max_monthly_clinical_shifts is null or max_monthly_clinical_shifts between 0 and 31
  ),
  constraint employees_effective_dates_valid check (
    effective_end_date is null
    or effective_start_date is null
    or effective_end_date >= effective_start_date
  ),
  constraint employees_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.constraint_rules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null,
  name text not null,
  rule_type text not null,
  rule_config jsonb not null default '{}'::jsonb,
  priority_order smallint,
  penalty_weight numeric(12,2),
  effective_start_date date,
  effective_end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint constraint_rules_code_format check (code ~ '^[A-Z0-9][A-Z0-9_]{2,79}$'),
  constraint constraint_rules_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint constraint_rules_type_valid check (rule_type in ('HARD', 'SOFT')),
  constraint constraint_rules_config_object check (jsonb_typeof(rule_config) = 'object'),
  constraint constraint_rules_priority_valid check (priority_order is null or priority_order > 0),
  constraint constraint_rules_weight_valid check (penalty_weight is null or penalty_weight >= 0),
  constraint constraint_rules_effective_dates_valid check (
    effective_end_date is null
    or effective_start_date is null
    or effective_end_date >= effective_start_date
  ),
  constraint constraint_rules_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.schedule_periods (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null,
  name text not null,
  schedule_start_date date not null,
  schedule_end_date date not null,
  context_start_date date,
  context_end_date date,
  status text not null default 'DRAFT',
  confirmed_version_id uuid,
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirmed_by_nickname text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_periods_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,79}$'),
  constraint schedule_periods_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint schedule_periods_dates_valid check (schedule_end_date >= schedule_start_date),
  constraint schedule_periods_context_valid check (
    (context_start_date is null and context_end_date is null)
    or (
      context_start_date is not null
      and context_end_date is not null
      and context_end_date >= context_start_date
      and context_end_date < schedule_start_date
    )
  ),
  constraint schedule_periods_status_valid check (
    status in ('DRAFT', 'INPUT_IMPORTED', 'READY', 'GENERATING', 'GENERATED', 'CONFIRMED', 'ARCHIVED')
  ),
  constraint schedule_periods_confirmation_consistent check (
    (
      status in ('CONFIRMED', 'ARCHIVED')
      and confirmed_version_id is not null
      and confirmed_at is not null
      and num_nonnulls(confirmed_by, confirmed_by_nickname) = 1
    )
    or (
      status not in ('CONFIRMED', 'ARCHIVED')
      and confirmed_version_id is null
      and confirmed_at is null
      and confirmed_by is null
      and confirmed_by_nickname is null
    )
  ),
  constraint schedule_periods_confirmer_nickname_not_blank check (
    confirmed_by_nickname is null
    or char_length(btrim(confirmed_by_nickname)) between 1 and 80
  ),
  constraint schedule_periods_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, department_id)
);

create table public.schedule_period_employees (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  employee_id uuid not null,
  nickname_snapshot text not null,
  skill_level_code_snapshot text not null,
  max_clinical_shifts smallint,
  is_available_for_period boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_period_employees_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint schedule_period_employees_employee_fk foreign key (employee_id, department_id)
    references public.employees(id, department_id) on delete restrict,
  constraint schedule_period_employees_nickname_not_blank check (
    char_length(btrim(nickname_snapshot)) between 1 and 80
  ),
  constraint schedule_period_employees_skill_code_format check (
    skill_level_code_snapshot ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
  ),
  constraint schedule_period_employees_max_shifts_valid check (
    max_clinical_shifts is null or max_clinical_shifts between 0 and 31
  ),
  constraint schedule_period_employees_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, schedule_period_id, department_id)
);

create table public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  source_type text not null,
  source_url text,
  storage_path text,
  original_filename text,
  file_hash text,
  import_status text not null default 'PENDING',
  raw_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  imported_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_imports_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint schedule_imports_source_type_valid check (source_type in ('GOOGLE_SHEET', 'EXCEL_UPLOAD', 'MANUAL_ENTRY')),
  constraint schedule_imports_source_required check (
    (source_type = 'GOOGLE_SHEET' and source_url is not null)
    or (source_type = 'EXCEL_UPLOAD' and storage_path is not null and original_filename is not null)
    or source_type = 'MANUAL_ENTRY'
  ),
  constraint schedule_imports_status_valid check (import_status in ('PENDING', 'PARSING', 'NORMALIZED', 'FAILED')),
  constraint schedule_imports_raw_snapshot_object check (jsonb_typeof(raw_snapshot) = 'object'),
  constraint schedule_imports_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, schedule_period_id, department_id)
);

create table public.schedule_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_import_id uuid not null,
  period_employee_id uuid not null,
  request_date date not null,
  raw_value text,
  normalized_type text not null,
  priority smallint,
  is_locked boolean not null default false,
  allowed_assignments text[] not null,
  normalization_status text not null,
  normalization_note text,
  confirmed_value text,
  confidence numeric(4,3) not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_requests_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint schedule_requests_import_fk foreign key (schedule_import_id, schedule_period_id, department_id)
    references public.schedule_imports(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_requests_period_employee_fk foreign key (period_employee_id, schedule_period_id, department_id)
    references public.schedule_period_employees(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_requests_type_valid check (
    normalized_type in ('AVAILABLE', 'OFF_REQUEST', 'OFF_OR_DAY', 'OFF_OR_NIGHT', 'VACATION', 'EDUCATION', 'AMBIGUOUS')
  ),
  constraint schedule_requests_priority_valid check (priority is null or priority between 1 and 4),
  constraint schedule_requests_allowed_nonempty check (cardinality(allowed_assignments) > 0),
  constraint schedule_requests_allowed_values check (
    allowed_assignments <@ array['D', 'N', 'OFF', 'VAC', 'ED']::text[]
  ),
  constraint schedule_requests_normalization_status_valid check (
    normalization_status in ('NORMALIZED', 'NEEDS_REVIEW', 'CONFIRMED', 'INVALID')
  ),
  constraint schedule_requests_confirmed_value_valid check (
    confirmed_value is null or confirmed_value in ('D', 'N', 'OFF', 'VAC', 'ED')
  ),
  constraint schedule_requests_confidence_valid check (confidence between 0 and 1),
  constraint schedule_requests_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, schedule_period_id, department_id)
);

create table public.previous_assignments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  period_employee_id uuid not null,
  shift_type_id uuid not null,
  schedule_import_id uuid,
  assignment_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint previous_assignments_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint previous_assignments_period_employee_fk foreign key (period_employee_id, schedule_period_id, department_id)
    references public.schedule_period_employees(id, schedule_period_id, department_id) on delete restrict,
  constraint previous_assignments_shift_type_fk foreign key (shift_type_id, department_id)
    references public.shift_types(id, department_id) on delete restrict,
  constraint previous_assignments_import_fk foreign key (schedule_import_id, schedule_period_id, department_id)
    references public.schedule_imports(id, schedule_period_id, department_id) on delete restrict,
  constraint previous_assignments_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, schedule_period_id, department_id)
);

create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  version_no integer not null,
  name text not null,
  status text not null default 'CANDIDATE',
  parent_version_id uuid,
  generation_type text not null default 'INITIAL',
  solver_status text not null,
  objective_score numeric(18,4),
  solver_duration_ms integer,
  constraint_config jsonb not null default '{}'::jsonb,
  generation_instruction text,
  generation_summary jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirmed_by_nickname text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_versions_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint schedule_versions_version_no_positive check (version_no > 0),
  constraint schedule_versions_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint schedule_versions_status_valid check (
    status in ('GENERATING', 'CANDIDATE', 'VALID', 'INVALID', 'CONFIRMED', 'REJECTED', 'SUPERSEDED')
  ),
  constraint schedule_versions_generation_type_valid check (
    generation_type in ('INITIAL', 'REGENERATE', 'MANUAL_ADJUSTMENT', 'WHAT_IF')
  ),
  constraint schedule_versions_solver_status_valid check (
    solver_status in ('PENDING', 'RUNNING', 'OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'ERROR', 'DEMO')
  ),
  constraint schedule_versions_solver_duration_valid check (
    solver_duration_ms is null or solver_duration_ms >= 0
  ),
  constraint schedule_versions_constraint_config_object check (jsonb_typeof(constraint_config) = 'object'),
  constraint schedule_versions_generation_summary_object check (jsonb_typeof(generation_summary) = 'object'),
  constraint schedule_versions_confirmation_consistent check (
    (
      status = 'CONFIRMED'
      and confirmed_at is not null
      and num_nonnulls(confirmed_by, confirmed_by_nickname) = 1
    )
    or (
      status <> 'CONFIRMED'
      and confirmed_at is null
      and confirmed_by is null
      and confirmed_by_nickname is null
    )
  ),
  constraint schedule_versions_confirmer_nickname_not_blank check (
    confirmed_by_nickname is null
    or char_length(btrim(confirmed_by_nickname)) between 1 and 80
  ),
  constraint schedule_versions_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  ),
  unique (id, schedule_period_id, department_id)
);

alter table public.schedule_versions
  add constraint schedule_versions_parent_fk
  foreign key (parent_version_id, schedule_period_id, department_id)
  references public.schedule_versions(id, schedule_period_id, department_id)
  on delete restrict;

alter table public.schedule_periods
  add constraint schedule_periods_confirmed_version_fk
  foreign key (confirmed_version_id, id, department_id)
  references public.schedule_versions(id, schedule_period_id, department_id)
  on delete restrict
  deferrable initially deferred;

create table public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_version_id uuid not null,
  period_employee_id uuid not null,
  shift_type_id uuid not null,
  assignment_date date not null,
  assignment_source text not null default 'SOLVER',
  is_manual_override boolean not null default false,
  override_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_assignments_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_assignments_period_employee_fk foreign key (period_employee_id, schedule_period_id, department_id)
    references public.schedule_period_employees(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_assignments_shift_type_fk foreign key (shift_type_id, department_id)
    references public.shift_types(id, department_id) on delete restrict,
  constraint schedule_assignments_source_valid check (
    assignment_source in ('SOLVER', 'LOCKED_REQUEST', 'MANUAL')
  ),
  constraint schedule_assignments_override_reason_required check (
    (not is_manual_override and override_reason is null)
    or (is_manual_override and char_length(btrim(override_reason)) > 0)
  ),
  constraint schedule_assignments_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.schedule_validation_results (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_version_id uuid not null,
  constraint_rule_id uuid not null,
  constraint_code_snapshot text not null,
  constraint_name_snapshot text not null,
  constraint_type_snapshot text not null,
  validation_status text not null,
  violation_count integer not null default 0,
  validation_details jsonb not null default '[]'::jsonb,
  validated_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_validation_results_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_validation_results_rule_fk foreign key (constraint_rule_id, department_id)
    references public.constraint_rules(id, department_id) on delete restrict,
  constraint schedule_validation_results_code_format check (
    constraint_code_snapshot ~ '^[A-Z0-9][A-Z0-9_]{2,79}$'
  ),
  constraint schedule_validation_results_name_not_blank check (
    char_length(btrim(constraint_name_snapshot)) between 1 and 160
  ),
  constraint schedule_validation_results_type_valid check (
    constraint_type_snapshot in ('HARD', 'SOFT')
  ),
  constraint schedule_validation_results_status_valid check (
    validation_status in ('PASS', 'FAIL', 'WARNING')
  ),
  constraint schedule_validation_results_violation_count_valid check (violation_count >= 0),
  constraint schedule_validation_results_status_consistent check (
    (validation_status = 'PASS' and violation_count = 0)
    or (validation_status in ('FAIL', 'WARNING'))
  ),
  constraint schedule_validation_results_details_array check (
    jsonb_typeof(validation_details) = 'array'
  ),
  constraint schedule_validation_results_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.schedule_request_outcomes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_version_id uuid not null,
  schedule_request_id uuid not null,
  is_satisfied boolean not null,
  assigned_shift_code text not null,
  penalty_score numeric(14,2) not null default 0,
  reason_code text,
  explanation text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_request_outcomes_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_request_outcomes_request_fk foreign key (schedule_request_id, schedule_period_id, department_id)
    references public.schedule_requests(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_request_outcomes_shift_valid check (
    assigned_shift_code in ('D', 'N', 'OFF', 'VAC', 'ED')
  ),
  constraint schedule_request_outcomes_penalty_valid check (penalty_score >= 0),
  constraint schedule_request_outcomes_reason_required check (
    is_satisfied or reason_code is not null
  ),
  constraint schedule_request_outcomes_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.schedule_version_metrics (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_version_id uuid not null,
  metric_code text not null,
  metric_value numeric(18,6),
  metric_detail jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_version_metrics_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_version_metrics_code_format check (
    metric_code ~ '^[A-Z0-9][A-Z0-9_]{2,79}$'
  ),
  constraint schedule_version_metrics_detail_object check (jsonb_typeof(metric_detail) = 'object'),
  constraint schedule_version_metrics_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.schedule_exports (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  schedule_period_id uuid not null,
  schedule_version_id uuid not null,
  export_format text not null,
  storage_path text not null,
  file_name text not null,
  file_hash text,
  exported_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_exports_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_exports_format_valid check (export_format in ('XLSX', 'CSV', 'PDF')),
  constraint schedule_exports_storage_path_not_blank check (char_length(btrim(storage_path)) > 0),
  constraint schedule_exports_file_name_not_blank check (char_length(btrim(file_name)) > 0),
  constraint schedule_exports_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

create table public.schedule_audit_logs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  schedule_period_id uuid,
  schedule_version_id uuid,
  action_code text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_nickname text,
  performed_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint schedule_audit_logs_period_fk foreign key (schedule_period_id, department_id)
    references public.schedule_periods(id, department_id) on delete restrict,
  constraint schedule_audit_logs_version_fk foreign key (schedule_version_id, schedule_period_id, department_id)
    references public.schedule_versions(id, schedule_period_id, department_id) on delete restrict,
  constraint schedule_audit_logs_action_code_format check (
    action_code ~ '^[A-Z0-9][A-Z0-9_]{2,99}$'
  ),
  constraint schedule_audit_logs_entity_type_format check (
    entity_type ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  constraint schedule_audit_logs_before_object check (
    before_data is null or jsonb_typeof(before_data) = 'object'
  ),
  constraint schedule_audit_logs_after_object check (
    after_data is null or jsonb_typeof(after_data) = 'object'
  ),
  constraint schedule_audit_logs_actor_nickname_not_blank check (
    actor_nickname is null
    or char_length(btrim(actor_nickname)) between 1 and 80
  ),
  constraint schedule_audit_logs_version_requires_period check (
    schedule_version_id is null or schedule_period_id is not null
  ),
  constraint schedule_audit_logs_soft_delete_consistent check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null)
  )
);

-- Natural-key uniqueness is scoped to live rows so a soft-deleted record can
-- be replaced without losing its history.
create unique index departments_active_code_uidx
  on public.departments (code)
  where is_active and deleted_at is null;
create unique index department_memberships_active_user_uidx
  on public.department_memberships (department_id, user_id)
  where is_active and deleted_at is null;
create unique index skill_levels_active_code_uidx
  on public.skill_levels (department_id, code)
  where is_active and deleted_at is null;
create unique index shift_types_active_code_uidx
  on public.shift_types (department_id, code)
  where is_active and deleted_at is null;
create unique index employees_active_nickname_uidx
  on public.employees (department_id, lower(nickname))
  where is_active and deleted_at is null;
create unique index constraint_rules_active_code_uidx
  on public.constraint_rules (department_id, code)
  where is_active and deleted_at is null;
create unique index schedule_periods_active_code_uidx
  on public.schedule_periods (department_id, code)
  where is_active and deleted_at is null;
create unique index schedule_period_employees_active_employee_uidx
  on public.schedule_period_employees (schedule_period_id, employee_id)
  where is_active and deleted_at is null;
create unique index schedule_requests_active_employee_date_uidx
  on public.schedule_requests (schedule_period_id, period_employee_id, request_date)
  where is_active and deleted_at is null;
create unique index previous_assignments_active_employee_date_uidx
  on public.previous_assignments (schedule_period_id, period_employee_id, assignment_date)
  where is_active and deleted_at is null;
create unique index schedule_versions_active_version_no_uidx
  on public.schedule_versions (schedule_period_id, version_no)
  where is_active and deleted_at is null;
create unique index schedule_versions_one_confirmed_uidx
  on public.schedule_versions (schedule_period_id)
  where status = 'CONFIRMED' and is_active and deleted_at is null;
create unique index schedule_assignments_active_employee_date_uidx
  on public.schedule_assignments (schedule_version_id, period_employee_id, assignment_date)
  where is_active and deleted_at is null;
create unique index schedule_validation_results_active_rule_uidx
  on public.schedule_validation_results (schedule_version_id, constraint_rule_id)
  where is_active and deleted_at is null;
create unique index schedule_request_outcomes_active_request_uidx
  on public.schedule_request_outcomes (schedule_version_id, schedule_request_id)
  where is_active and deleted_at is null;
create unique index schedule_version_metrics_active_code_uidx
  on public.schedule_version_metrics (schedule_version_id, metric_code)
  where is_active and deleted_at is null;

-- Foreign-key, RLS, and primary application access paths.
create index department_memberships_user_idx
  on public.department_memberships (user_id, department_id)
  where is_active and deleted_at is null;
create index department_memberships_department_role_idx
  on public.department_memberships (department_id, role)
  where is_active and deleted_at is null;
create index employees_skill_level_idx on public.employees (skill_level_id);
create index employees_department_status_idx
  on public.employees (department_id, employment_status)
  where is_active and deleted_at is null;
create index schedule_periods_department_status_start_idx
  on public.schedule_periods (department_id, status, schedule_start_date desc)
  where is_active and deleted_at is null;
create index schedule_periods_confirmed_version_idx
  on public.schedule_periods (confirmed_version_id)
  where confirmed_version_id is not null;
create index schedule_period_employees_employee_idx
  on public.schedule_period_employees (employee_id);
create index schedule_period_employees_period_skill_idx
  on public.schedule_period_employees (schedule_period_id, skill_level_code_snapshot)
  where is_active and deleted_at is null;
create index schedule_imports_period_created_idx
  on public.schedule_imports (schedule_period_id, created_at desc)
  where is_active and deleted_at is null;
create index schedule_requests_import_idx on public.schedule_requests (schedule_import_id);
create index schedule_requests_period_date_type_idx
  on public.schedule_requests (schedule_period_id, request_date, normalized_type)
  where is_active and deleted_at is null;
create index previous_assignments_import_idx
  on public.previous_assignments (schedule_import_id)
  where schedule_import_id is not null;
create index previous_assignments_shift_type_idx on public.previous_assignments (shift_type_id);
create index schedule_versions_parent_idx
  on public.schedule_versions (parent_version_id)
  where parent_version_id is not null;
create index schedule_versions_period_status_idx
  on public.schedule_versions (schedule_period_id, status, version_no desc)
  where is_active and deleted_at is null;
create index schedule_assignments_version_date_shift_idx
  on public.schedule_assignments (schedule_version_id, assignment_date, shift_type_id)
  where is_active and deleted_at is null;
create index schedule_assignments_period_employee_idx
  on public.schedule_assignments (period_employee_id, assignment_date)
  where is_active and deleted_at is null;
create index schedule_assignments_shift_type_idx on public.schedule_assignments (shift_type_id);
create index schedule_validation_results_version_status_idx
  on public.schedule_validation_results (schedule_version_id, constraint_type_snapshot, validation_status)
  where is_active and deleted_at is null;
create index schedule_validation_results_rule_idx
  on public.schedule_validation_results (constraint_rule_id);
create index schedule_request_outcomes_request_idx
  on public.schedule_request_outcomes (schedule_request_id);
create index schedule_request_outcomes_version_satisfied_idx
  on public.schedule_request_outcomes (schedule_version_id, is_satisfied)
  where is_active and deleted_at is null;
create index schedule_version_metrics_version_idx
  on public.schedule_version_metrics (schedule_version_id)
  where is_active and deleted_at is null;
create index schedule_exports_version_exported_idx
  on public.schedule_exports (schedule_version_id, exported_at desc)
  where is_active and deleted_at is null;
create index schedule_audit_logs_period_performed_idx
  on public.schedule_audit_logs (schedule_period_id, performed_at desc);
create index schedule_audit_logs_version_performed_idx
  on public.schedule_audit_logs (schedule_version_id, performed_at desc)
  where schedule_version_id is not null;

create or replace function nurseflow_private.apply_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(v_actor, new.created_by);
    new.updated_at := new.created_at;
    new.updated_by := coalesce(v_actor, new.updated_by, new.created_by);

    if new.is_active then
      new.deleted_at := null;
      new.deleted_by := null;
    else
      new.deleted_at := coalesce(new.deleted_at, now());
      new.deleted_by := coalesce(v_actor, new.deleted_by);
    end if;

    return new;
  end if;

  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := coalesce(v_actor, new.updated_by, old.updated_by);

  if new.is_active then
    new.deleted_at := null;
    new.deleted_by := null;
  elsif old.is_active then
    new.deleted_at := coalesce(new.deleted_at, now());
    new.deleted_by := coalesce(v_actor, new.deleted_by);
  else
    new.deleted_at := coalesce(old.deleted_at, new.deleted_at, now());
    new.deleted_by := coalesce(old.deleted_by, v_actor, new.deleted_by);
  end if;

  return new;
end;
$$;

create or replace function nurseflow_private.has_department_role(
  p_department_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.department_memberships as membership
    where membership.department_id = p_department_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (p_roles)
      and membership.is_active
      and membership.deleted_at is null
  );
$$;

create or replace function nurseflow_private.enforce_schedule_date_within_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schedule_start date;
  v_schedule_end date;
  v_context_start date;
  v_context_end date;
  v_value date;
begin
  select
    period.schedule_start_date,
    period.schedule_end_date,
    period.context_start_date,
    period.context_end_date
  into
    v_schedule_start,
    v_schedule_end,
    v_context_start,
    v_context_end
  from public.schedule_periods as period
  where period.id = new.schedule_period_id
    and period.department_id = new.department_id;

  if not found then
    raise exception 'Schedule period does not exist in the supplied department.'
      using errcode = '23503';
  end if;

  if tg_table_name = 'schedule_requests' then
    v_value := new.request_date;
  else
    v_value := new.assignment_date;
  end if;

  if tg_table_name = 'previous_assignments' then
    if v_context_start is null
      or v_context_end is null
      or v_value not between v_context_start and v_context_end then
      raise exception 'Previous assignment date % is outside the period context range.', v_value
        using errcode = '23514';
    end if;
  elsif v_value not between v_schedule_start and v_schedule_end then
    raise exception 'Schedule date % is outside the scheduling range.', v_value
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function nurseflow_private.protect_confirmed_period_input()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_department_id uuid;
  v_period_status text;
begin
  if tg_op = 'DELETE' then
    v_period_id := old.schedule_period_id;
    v_department_id := old.department_id;
  else
    v_period_id := new.schedule_period_id;
    v_department_id := new.department_id;
  end if;

  select period.status
  into v_period_status
  from public.schedule_periods as period
  where period.id = v_period_id
    and period.department_id = v_department_id;

  if not found then
    raise exception 'Schedule period does not exist in the supplied department.'
      using errcode = '23503';
  end if;

  if v_period_status in ('CONFIRMED', 'ARCHIVED') then
    raise exception 'Inputs for a confirmed or archived schedule period are immutable.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function nurseflow_private.protect_schedule_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status in ('CONFIRMED', 'ARCHIVED') then
    raise exception 'A schedule period cannot be inserted as confirmed or archived.'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.status in ('CONFIRMED', 'ARCHIVED') then
    raise exception 'A confirmed or archived schedule period is immutable.'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE'
    and new.status in ('CONFIRMED', 'ARCHIVED')
    and current_user <> 'postgres' then
    raise exception 'Use confirm_schedule_version() to confirm a schedule period.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function nurseflow_private.protect_schedule_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_department_id uuid;
  v_period_status text;
begin
  if tg_op = 'DELETE' then
    v_period_id := old.schedule_period_id;
    v_department_id := old.department_id;
  else
    v_period_id := new.schedule_period_id;
    v_department_id := new.department_id;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.status = 'CONFIRMED' then
    raise exception 'A confirmed schedule version is immutable.'
      using errcode = '55000';
  end if;

  select period.status
  into v_period_status
  from public.schedule_periods as period
  where period.id = v_period_id
    and period.department_id = v_department_id;

  if not found then
    raise exception 'Schedule period does not exist in the supplied department.'
      using errcode = '23503';
  end if;

  if v_period_status in ('CONFIRMED', 'ARCHIVED') then
    raise exception 'Versions for a confirmed or archived schedule period are immutable.'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' and new.status = 'CONFIRMED' then
    raise exception 'A schedule version cannot be inserted as confirmed.'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and new.status = 'CONFIRMED' and current_user <> 'postgres' then
    raise exception 'Use confirm_schedule_version() to confirm a schedule version.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function nurseflow_private.protect_schedule_version_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_period_id uuid;
  v_department_id uuid;
  v_version_status text;
  v_period_status text;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.schedule_version_id;
    v_period_id := old.schedule_period_id;
    v_department_id := old.department_id;
  else
    v_version_id := new.schedule_version_id;
    v_period_id := new.schedule_period_id;
    v_department_id := new.department_id;
  end if;

  select version.status, period.status
  into v_version_status, v_period_status
  from public.schedule_versions as version
  join public.schedule_periods as period
    on period.id = version.schedule_period_id
   and period.department_id = version.department_id
  where version.id = v_version_id
    and version.schedule_period_id = v_period_id
    and version.department_id = v_department_id;

  if not found then
    raise exception 'Schedule version does not exist in the supplied period and department.'
      using errcode = '23503';
  end if;

  if v_version_status = 'CONFIRMED' or v_period_status in ('CONFIRMED', 'ARCHIVED') then
    raise exception 'Results for a confirmed schedule version are immutable.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function nurseflow_private.require_confirmed_export()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version_status text;
begin
  select version.status
  into v_version_status
  from public.schedule_versions as version
  where version.id = new.schedule_version_id
    and version.schedule_period_id = new.schedule_period_id
    and version.department_id = new.department_id;

  if not found then
    raise exception 'Schedule version does not exist in the supplied period and department.'
      using errcode = '23503';
  end if;

  if v_version_status <> 'CONFIRMED' then
    raise exception 'Only confirmed schedule versions can be exported.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create or replace function nurseflow_private.prevent_update_or_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only.', tg_table_name
    using errcode = '55000';
end;
$$;

-- Apply audit behavior to every application table.
do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departments',
    'department_memberships',
    'skill_levels',
    'shift_types',
    'employees',
    'constraint_rules',
    'schedule_periods',
    'schedule_period_employees',
    'schedule_imports',
    'schedule_requests',
    'previous_assignments',
    'schedule_versions',
    'schedule_assignments',
    'schedule_validation_results',
    'schedule_request_outcomes',
    'schedule_version_metrics',
    'schedule_exports',
    'schedule_audit_logs'
  ]
  loop
    execute format(
      'create trigger %I before insert or update on public.%I '
      || 'for each row execute function nurseflow_private.apply_audit_fields()',
      v_table || '_apply_audit_fields',
      v_table
    );
  end loop;
end;
$migration$;

create trigger schedule_requests_enforce_date
before insert or update on public.schedule_requests
for each row execute function nurseflow_private.enforce_schedule_date_within_period();
create trigger previous_assignments_enforce_date
before insert or update on public.previous_assignments
for each row execute function nurseflow_private.enforce_schedule_date_within_period();
create trigger schedule_assignments_enforce_date
before insert or update on public.schedule_assignments
for each row execute function nurseflow_private.enforce_schedule_date_within_period();

create trigger schedule_periods_protect_confirmation
before insert or update or delete on public.schedule_periods
for each row execute function nurseflow_private.protect_schedule_period();
create trigger schedule_versions_protect_confirmation
before insert or update or delete on public.schedule_versions
for each row execute function nurseflow_private.protect_schedule_version();

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'schedule_period_employees',
    'schedule_imports',
    'schedule_requests',
    'previous_assignments'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function nurseflow_private.protect_confirmed_period_input()',
      v_table || '_protect_confirmed_period',
      v_table
    );
  end loop;
end;
$migration$;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'schedule_assignments',
    'schedule_validation_results',
    'schedule_request_outcomes',
    'schedule_version_metrics'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function nurseflow_private.protect_schedule_version_child()',
      v_table || '_protect_confirmed_version',
      v_table
    );
  end loop;
end;
$migration$;

create trigger schedule_exports_require_confirmed_version
before insert on public.schedule_exports
for each row execute function nurseflow_private.require_confirmed_export();
create trigger schedule_exports_append_only
before update or delete on public.schedule_exports
for each row execute function nurseflow_private.prevent_update_or_delete();
create trigger schedule_audit_logs_append_only
before update or delete on public.schedule_audit_logs
for each row execute function nurseflow_private.prevent_update_or_delete();

-- Authenticated confirmation is a narrow SECURITY DEFINER entry point so a
-- reviewer can atomically change protected columns while ordinary table writes
-- remain unavailable. It has an empty search_path, contains no dynamic SQL,
-- authorizes auth.uid() against active department membership, and re-validates
-- completeness and every effective hard rule before mutation.
create or replace function public.confirm_schedule_version(p_schedule_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_lookup_period_id uuid;
  v_lookup_department_id uuid;
  v_period public.schedule_periods%rowtype;
  v_version public.schedule_versions%rowtype;
  v_expected_hard_rules bigint;
  v_passed_hard_rules bigint;
  v_expected_assignments bigint;
  v_actual_assignments bigint;
  v_confirmed_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'Authentication is required to confirm a schedule.'
      using errcode = '28000';
  end if;

  select version.schedule_period_id, version.department_id
  into v_lookup_period_id, v_lookup_department_id
  from public.schedule_versions as version
  where version.id = p_schedule_version_id
    and version.is_active
    and version.deleted_at is null;

  if not found then
    raise exception 'Schedule version was not found.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.department_memberships as membership
    where membership.department_id = v_lookup_department_id
      and membership.user_id = v_actor
      and membership.role in ('ADMIN', 'SCHEDULER', 'REVIEWER')
      and membership.is_active
      and membership.deleted_at is null
  ) then
    raise exception 'You are not authorized to confirm schedules for this department.'
      using errcode = '42501';
  end if;

  -- Lock the aggregate root before its candidate version. Every confirmation
  -- follows this same order to avoid deadlocks.
  select period.*
  into v_period
  from public.schedule_periods as period
  where period.id = v_lookup_period_id
    and period.department_id = v_lookup_department_id
    and period.is_active
    and period.deleted_at is null
  for update;

  if not found then
    raise exception 'Schedule period was not found.'
      using errcode = 'P0002';
  end if;

  select version.*
  into v_version
  from public.schedule_versions as version
  where version.id = p_schedule_version_id
    and version.schedule_period_id = v_period.id
    and version.department_id = v_period.department_id
    and version.is_active
    and version.deleted_at is null
  for update;

  if not found then
    raise exception 'Schedule version changed while confirmation was starting.'
      using errcode = '40001';
  end if;

  if v_period.status <> 'GENERATED'
    or v_period.confirmed_version_id is not null then
    raise exception 'Only an unconfirmed GENERATED period can be confirmed.'
      using errcode = '55000';
  end if;

  if v_version.status <> 'VALID' then
    raise exception 'Only a VALID schedule version can be confirmed.'
      using errcode = '55000';
  end if;

  if v_version.solver_status not in ('OPTIMAL', 'FEASIBLE') then
    raise exception 'Only an OPTIMAL or FEASIBLE solver result can be confirmed.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_expected_hard_rules
  from public.constraint_rules as rule
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  if v_expected_hard_rules = 0 then
    raise exception 'The department has no effective hard constraints configured.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_passed_hard_rules
  from public.constraint_rules as rule
  join public.schedule_validation_results as result
    on result.constraint_rule_id = rule.id
   and result.department_id = rule.department_id
   and result.schedule_period_id = v_period.id
   and result.schedule_version_id = v_version.id
   and result.constraint_code_snapshot = rule.code
   and result.constraint_type_snapshot = 'HARD'
   and result.validation_status = 'PASS'
   and result.violation_count = 0
   and result.is_active
   and result.deleted_at is null
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  if v_passed_hard_rules <> v_expected_hard_rules then
    raise exception 'Every effective hard constraint must have one passing validation result (% of % passed).',
      v_passed_hard_rules,
      v_expected_hard_rules
      using errcode = '23514';
  end if;

  select
    count(*) * (v_period.schedule_end_date - v_period.schedule_start_date + 1)
  into v_expected_assignments
  from public.schedule_period_employees as period_employee
  where period_employee.schedule_period_id = v_period.id
    and period_employee.department_id = v_period.department_id
    and period_employee.is_available_for_period
    and period_employee.is_active
    and period_employee.deleted_at is null;

  if v_expected_assignments = 0 then
    raise exception 'The schedule period has no available employees.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_actual_assignments
  from public.schedule_assignments as assignment
  join public.schedule_period_employees as period_employee
    on period_employee.id = assignment.period_employee_id
   and period_employee.schedule_period_id = assignment.schedule_period_id
   and period_employee.department_id = assignment.department_id
   and period_employee.is_available_for_period
   and period_employee.is_active
   and period_employee.deleted_at is null
  where assignment.schedule_version_id = v_version.id
    and assignment.schedule_period_id = v_period.id
    and assignment.department_id = v_period.department_id
    and assignment.is_active
    and assignment.deleted_at is null;

  if v_actual_assignments <> v_expected_assignments then
    raise exception 'Schedule assignment matrix is incomplete (% of % assignments present).',
      v_actual_assignments,
      v_expected_assignments
      using errcode = '23514';
  end if;

  update public.schedule_versions
  set
    status = 'SUPERSEDED',
    updated_by = v_actor
  where schedule_period_id = v_period.id
    and department_id = v_period.department_id
    and id <> v_version.id
    and status in ('CANDIDATE', 'VALID')
    and is_active
    and deleted_at is null;

  update public.schedule_versions
  set
    status = 'CONFIRMED',
    confirmed_at = v_confirmed_at,
    confirmed_by = v_actor,
    updated_by = v_actor
  where id = v_version.id;

  update public.schedule_periods
  set
    status = 'CONFIRMED',
    confirmed_version_id = v_version.id,
    confirmed_at = v_confirmed_at,
    confirmed_by = v_actor,
    updated_by = v_actor
  where id = v_period.id;

  insert into public.schedule_audit_logs (
    department_id,
    schedule_period_id,
    schedule_version_id,
    action_code,
    entity_type,
    entity_id,
    after_data,
    actor_id,
    performed_at,
    created_by,
    updated_by
  )
  values (
    v_period.department_id,
    v_period.id,
    v_version.id,
    'VERSION_CONFIRMED',
    'schedule_version',
    v_version.id,
    jsonb_build_object(
      'status', 'CONFIRMED',
      'version_no', v_version.version_no,
      'hard_constraints_passed', v_passed_hard_rules,
      'assignment_count', v_actual_assignments
    ),
    v_actor,
    v_confirmed_at,
    v_actor,
    v_actor
  );

  return jsonb_build_object(
    'schedule_period_id', v_period.id,
    'schedule_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', 'CONFIRMED',
    'confirmed_at', v_confirmed_at,
    'confirmed_by', v_actor,
    'hard_constraints_passed', v_passed_hard_rules,
    'assignment_count', v_actual_assignments
  );
end;
$$;

-- Showcase/server confirmation path. The browser never receives the secret
-- key; a trusted Next server route calls this service-role-only RPC and records
-- a non-PII operator nickname when no Supabase Auth session exists. It repeats
-- every confirmation gate used by the authenticated RPC.
create or replace function public.confirm_schedule_version_server(
  p_schedule_version_id uuid,
  p_actor_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_nickname text := nullif(btrim(p_actor_nickname), '');
  v_lookup_period_id uuid;
  v_lookup_department_id uuid;
  v_period public.schedule_periods%rowtype;
  v_version public.schedule_versions%rowtype;
  v_expected_hard_rules bigint;
  v_passed_hard_rules bigint;
  v_expected_assignments bigint;
  v_actual_assignments bigint;
  v_confirmed_at timestamptz := now();
begin
  if v_actor_nickname is null or char_length(v_actor_nickname) > 80 then
    raise exception 'actor_nickname must contain between 1 and 80 characters.'
      using errcode = '22023';
  end if;

  select version.schedule_period_id, version.department_id
  into v_lookup_period_id, v_lookup_department_id
  from public.schedule_versions as version
  where version.id = p_schedule_version_id
    and version.is_active
    and version.deleted_at is null;

  if not found then
    raise exception 'Schedule version was not found.'
      using errcode = 'P0002';
  end if;

  -- Use the same aggregate lock order as the authenticated confirmation RPC.
  select period.*
  into v_period
  from public.schedule_periods as period
  where period.id = v_lookup_period_id
    and period.department_id = v_lookup_department_id
    and period.is_active
    and period.deleted_at is null
  for update;

  if not found then
    raise exception 'Schedule period was not found.'
      using errcode = 'P0002';
  end if;

  select version.*
  into v_version
  from public.schedule_versions as version
  where version.id = p_schedule_version_id
    and version.schedule_period_id = v_period.id
    and version.department_id = v_period.department_id
    and version.is_active
    and version.deleted_at is null
  for update;

  if not found then
    raise exception 'Schedule version changed while confirmation was starting.'
      using errcode = '40001';
  end if;

  if v_period.status <> 'GENERATED'
    or v_period.confirmed_version_id is not null then
    raise exception 'Only an unconfirmed GENERATED period can be confirmed.'
      using errcode = '55000';
  end if;

  if v_version.status <> 'VALID' then
    raise exception 'Only a VALID schedule version can be confirmed.'
      using errcode = '55000';
  end if;

  if v_version.solver_status not in ('OPTIMAL', 'FEASIBLE') then
    raise exception 'Only an OPTIMAL or FEASIBLE solver result can be confirmed.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_expected_hard_rules
  from public.constraint_rules as rule
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  if v_expected_hard_rules = 0 then
    raise exception 'The department has no effective hard constraints configured.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_passed_hard_rules
  from public.constraint_rules as rule
  join public.schedule_validation_results as result
    on result.constraint_rule_id = rule.id
   and result.department_id = rule.department_id
   and result.schedule_period_id = v_period.id
   and result.schedule_version_id = v_version.id
   and result.constraint_code_snapshot = rule.code
   and result.constraint_type_snapshot = 'HARD'
   and result.validation_status = 'PASS'
   and result.violation_count = 0
   and result.is_active
   and result.deleted_at is null
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  if v_passed_hard_rules <> v_expected_hard_rules then
    raise exception 'Every effective hard constraint must have one passing validation result (% of % passed).',
      v_passed_hard_rules,
      v_expected_hard_rules
      using errcode = '23514';
  end if;

  select
    count(*) * (v_period.schedule_end_date - v_period.schedule_start_date + 1)
  into v_expected_assignments
  from public.schedule_period_employees as period_employee
  where period_employee.schedule_period_id = v_period.id
    and period_employee.department_id = v_period.department_id
    and period_employee.is_available_for_period
    and period_employee.is_active
    and period_employee.deleted_at is null;

  if v_expected_assignments = 0 then
    raise exception 'The schedule period has no available employees.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_actual_assignments
  from public.schedule_assignments as assignment
  join public.schedule_period_employees as period_employee
    on period_employee.id = assignment.period_employee_id
   and period_employee.schedule_period_id = assignment.schedule_period_id
   and period_employee.department_id = assignment.department_id
   and period_employee.is_available_for_period
   and period_employee.is_active
   and period_employee.deleted_at is null
  where assignment.schedule_version_id = v_version.id
    and assignment.schedule_period_id = v_period.id
    and assignment.department_id = v_period.department_id
    and assignment.is_active
    and assignment.deleted_at is null;

  if v_actual_assignments <> v_expected_assignments then
    raise exception 'Schedule assignment matrix is incomplete (% of % assignments present).',
      v_actual_assignments,
      v_expected_assignments
      using errcode = '23514';
  end if;

  update public.schedule_versions
  set
    status = 'SUPERSEDED',
    updated_by = null
  where schedule_period_id = v_period.id
    and department_id = v_period.department_id
    and id <> v_version.id
    and status in ('CANDIDATE', 'VALID')
    and is_active
    and deleted_at is null;

  update public.schedule_versions
  set
    status = 'CONFIRMED',
    confirmed_at = v_confirmed_at,
    confirmed_by = null,
    confirmed_by_nickname = v_actor_nickname,
    updated_by = null
  where id = v_version.id;

  update public.schedule_periods
  set
    status = 'CONFIRMED',
    confirmed_version_id = v_version.id,
    confirmed_at = v_confirmed_at,
    confirmed_by = null,
    confirmed_by_nickname = v_actor_nickname,
    updated_by = null
  where id = v_period.id;

  insert into public.schedule_audit_logs (
    department_id,
    schedule_period_id,
    schedule_version_id,
    action_code,
    entity_type,
    entity_id,
    after_data,
    actor_id,
    actor_nickname,
    performed_at
  )
  values (
    v_period.department_id,
    v_period.id,
    v_version.id,
    'VERSION_CONFIRMED',
    'schedule_version',
    v_version.id,
    jsonb_build_object(
      'status', 'CONFIRMED',
      'version_no', v_version.version_no,
      'confirmed_by_nickname', v_actor_nickname,
      'hard_constraints_passed', v_passed_hard_rules,
      'assignment_count', v_actual_assignments
    ),
    null,
    v_actor_nickname,
    v_confirmed_at
  );

  return jsonb_build_object(
    'schedule_period_id', v_period.id,
    'schedule_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', 'CONFIRMED',
    'confirmed_at', v_confirmed_at,
    'confirmed_by', null,
    'confirmed_by_nickname', v_actor_nickname,
    'hard_constraints_passed', v_passed_hard_rules,
    'assignment_count', v_actual_assignments
  );
end;
$$;

-- Server-only persistence boundary for solver output. Master data, the period,
-- period employee snapshots, imports, requests, and previous assignments must
-- already exist. The service route sends one bounded JSON payload; any invalid
-- reference or duplicate causes the entire function call to roll back.
create or replace function public.save_schedule_candidate(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_department_id uuid;
  v_period_id uuid;
  v_period public.schedule_periods%rowtype;
  v_version public.schedule_versions%rowtype;
  v_version_payload jsonb;
  v_assignments jsonb;
  v_validations jsonb;
  v_metrics jsonb;
  v_expected_items bigint;
  v_inserted_items bigint;
  v_expected_assignments bigint;
  v_actual_assignments bigint;
  v_expected_hard_rules bigint;
  v_passed_hard_rules bigint;
  v_next_version_no integer;
  v_solver_status text;
  v_is_valid boolean;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Candidate payload must be a JSON object.'
      using errcode = '22023';
  end if;

  v_department_id := nullif(p_payload ->> 'department_id', '')::uuid;
  v_period_id := nullif(p_payload ->> 'schedule_period_id', '')::uuid;
  v_version_payload := coalesce(p_payload -> 'version', '{}'::jsonb);
  v_assignments := coalesce(p_payload -> 'assignments', '[]'::jsonb);
  v_validations := coalesce(p_payload -> 'validations', '[]'::jsonb);
  v_metrics := coalesce(p_payload -> 'metrics', '[]'::jsonb);

  if v_department_id is null or v_period_id is null then
    raise exception 'department_id and schedule_period_id are required.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_version_payload) <> 'object'
    or jsonb_typeof(v_assignments) <> 'array'
    or jsonb_typeof(v_validations) <> 'array'
    or jsonb_typeof(v_metrics) <> 'array' then
    raise exception 'version must be an object; assignments, validations, and metrics must be arrays.'
      using errcode = '22023';
  end if;

  v_solver_status := upper(coalesce(v_version_payload ->> 'solver_status', ''));
  if v_solver_status not in ('OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'ERROR') then
    raise exception 'version.solver_status must be OPTIMAL, FEASIBLE, INFEASIBLE, or ERROR.'
      using errcode = '22023';
  end if;

  select period.*
  into v_period
  from public.schedule_periods as period
  where period.id = v_period_id
    and period.department_id = v_department_id
    and period.is_active
    and period.deleted_at is null
  for update;

  if not found then
    raise exception 'Schedule period was not found.'
      using errcode = 'P0002';
  end if;

  if v_period.status not in ('READY', 'GENERATED')
    or v_period.confirmed_version_id is not null then
    raise exception 'Candidates can only be saved to an unconfirmed READY or GENERATED period.'
      using errcode = '55000';
  end if;

  select coalesce(max(version.version_no), 0) + 1
  into v_next_version_no
  from public.schedule_versions as version
  where version.schedule_period_id = v_period.id
    and version.department_id = v_period.department_id;

  insert into public.schedule_versions (
    department_id,
    schedule_period_id,
    version_no,
    name,
    status,
    parent_version_id,
    generation_type,
    solver_status,
    objective_score,
    solver_duration_ms,
    constraint_config,
    generation_instruction,
    generation_summary
  )
  values (
    v_period.department_id,
    v_period.id,
    v_next_version_no,
    coalesce(nullif(btrim(v_version_payload ->> 'name'), ''), 'Candidate V' || v_next_version_no),
    'CANDIDATE',
    nullif(v_version_payload ->> 'parent_version_id', '')::uuid,
    upper(coalesce(v_version_payload ->> 'generation_type', 'INITIAL')),
    v_solver_status,
    nullif(v_version_payload ->> 'objective_score', '')::numeric,
    nullif(v_version_payload ->> 'solver_duration_ms', '')::integer,
    coalesce(v_version_payload -> 'constraint_config', '{}'::jsonb),
    nullif(v_version_payload ->> 'generation_instruction', ''),
    coalesce(v_version_payload -> 'generation_summary', '{}'::jsonb)
  )
  returning * into v_version;

  v_expected_items := jsonb_array_length(v_assignments);

  insert into public.schedule_assignments (
    department_id,
    schedule_period_id,
    schedule_version_id,
    period_employee_id,
    shift_type_id,
    assignment_date,
    assignment_source,
    is_manual_override,
    override_reason
  )
  select
    v_period.department_id,
    v_period.id,
    v_version.id,
    period_employee.id,
    shift_type.id,
    (item ->> 'assignment_date')::date,
    upper(coalesce(item ->> 'assignment_source', 'SOLVER')),
    coalesce((item ->> 'is_manual_override')::boolean, false),
    nullif(item ->> 'override_reason', '')
  from jsonb_array_elements(v_assignments) as item
  join public.schedule_period_employees as period_employee
    on period_employee.id = nullif(item ->> 'period_employee_id', '')::uuid
   and period_employee.schedule_period_id = v_period.id
   and period_employee.department_id = v_period.department_id
   and period_employee.is_available_for_period
   and period_employee.is_active
   and period_employee.deleted_at is null
  join public.shift_types as shift_type
    on shift_type.department_id = v_period.department_id
   and shift_type.code = upper(item ->> 'shift_code')
   and shift_type.is_active
   and shift_type.deleted_at is null;

  get diagnostics v_inserted_items = row_count;
  if v_inserted_items <> v_expected_items then
    raise exception 'One or more assignments reference an unknown period employee or shift code (% of % inserted).',
      v_inserted_items,
      v_expected_items
      using errcode = '23503';
  end if;

  v_expected_items := jsonb_array_length(v_validations);

  insert into public.schedule_validation_results (
    department_id,
    schedule_period_id,
    schedule_version_id,
    constraint_rule_id,
    constraint_code_snapshot,
    constraint_name_snapshot,
    constraint_type_snapshot,
    validation_status,
    violation_count,
    validation_details,
    validated_at
  )
  select
    v_period.department_id,
    v_period.id,
    v_version.id,
    rule.id,
    rule.code,
    rule.name,
    rule.rule_type,
    upper(item ->> 'validation_status'),
    coalesce((item ->> 'violation_count')::integer, 0),
    coalesce(item -> 'validation_details', '[]'::jsonb),
    coalesce((item ->> 'validated_at')::timestamptz, now())
  from jsonb_array_elements(v_validations) as item
  join public.constraint_rules as rule
    on rule.department_id = v_period.department_id
   and rule.code = upper(item ->> 'constraint_code')
   and rule.is_active
   and rule.deleted_at is null;

  get diagnostics v_inserted_items = row_count;
  if v_inserted_items <> v_expected_items then
    raise exception 'One or more validations reference an unknown constraint code (% of % inserted).',
      v_inserted_items,
      v_expected_items
      using errcode = '23503';
  end if;

  v_expected_items := jsonb_array_length(v_metrics);

  insert into public.schedule_version_metrics (
    department_id,
    schedule_period_id,
    schedule_version_id,
    metric_code,
    metric_value,
    metric_detail
  )
  select
    v_period.department_id,
    v_period.id,
    v_version.id,
    upper(item ->> 'metric_code'),
    nullif(item ->> 'metric_value', '')::numeric,
    coalesce(item -> 'metric_detail', '{}'::jsonb)
  from jsonb_array_elements(v_metrics) as item;

  get diagnostics v_inserted_items = row_count;
  if v_inserted_items <> v_expected_items then
    raise exception 'Metric persistence did not consume the complete payload.'
      using errcode = '22023';
  end if;

  select
    count(*) * (v_period.schedule_end_date - v_period.schedule_start_date + 1)
  into v_expected_assignments
  from public.schedule_period_employees as period_employee
  where period_employee.schedule_period_id = v_period.id
    and period_employee.department_id = v_period.department_id
    and period_employee.is_available_for_period
    and period_employee.is_active
    and period_employee.deleted_at is null;

  select count(*)
  into v_actual_assignments
  from public.schedule_assignments as assignment
  where assignment.schedule_version_id = v_version.id
    and assignment.is_active
    and assignment.deleted_at is null;

  select count(*)
  into v_expected_hard_rules
  from public.constraint_rules as rule
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  select count(*)
  into v_passed_hard_rules
  from public.constraint_rules as rule
  join public.schedule_validation_results as result
    on result.constraint_rule_id = rule.id
   and result.schedule_version_id = v_version.id
   and result.validation_status = 'PASS'
   and result.violation_count = 0
   and result.is_active
   and result.deleted_at is null
  where rule.department_id = v_period.department_id
    and rule.rule_type = 'HARD'
    and rule.is_active
    and rule.deleted_at is null
    and (rule.effective_start_date is null or rule.effective_start_date <= v_period.schedule_end_date)
    and (rule.effective_end_date is null or rule.effective_end_date >= v_period.schedule_start_date);

  v_is_valid :=
    v_solver_status in ('OPTIMAL', 'FEASIBLE')
    and v_expected_assignments > 0
    and v_actual_assignments = v_expected_assignments
    and v_expected_hard_rules > 0
    and v_passed_hard_rules = v_expected_hard_rules;

  update public.schedule_versions
  set
    status = case when v_is_valid then 'VALID' else 'INVALID' end,
    updated_by = null
  where id = v_version.id
  returning * into v_version;

  update public.schedule_periods
  set status = 'GENERATED'
  where id = v_period.id;

  insert into public.schedule_audit_logs (
    department_id,
    schedule_period_id,
    schedule_version_id,
    action_code,
    entity_type,
    entity_id,
    after_data,
    performed_at
  )
  values (
    v_period.department_id,
    v_period.id,
    v_version.id,
    'SCHEDULE_GENERATED',
    'schedule_version',
    v_version.id,
    jsonb_build_object(
      'status', v_version.status,
      'version_no', v_version.version_no,
      'solver_status', v_version.solver_status,
      'hard_constraints_passed', v_passed_hard_rules,
      'hard_constraints_total', v_expected_hard_rules,
      'assignment_count', v_actual_assignments,
      'expected_assignment_count', v_expected_assignments
    ),
    now()
  );

  return jsonb_build_object(
    'schedule_period_id', v_period.id,
    'schedule_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', v_version.status,
    'solver_status', v_version.solver_status,
    'hard_constraints_passed', v_passed_hard_rules,
    'hard_constraints_total', v_expected_hard_rules,
    'assignment_count', v_actual_assignments,
    'expected_assignment_count', v_expected_assignments
  );
end;
$$;

-- RLS is enabled and forced on every application table. The service_role keeps
-- its Supabase BYPASSRLS behavior, while authenticated clients are authorized
-- through active department membership.
do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departments',
    'department_memberships',
    'skill_levels',
    'shift_types',
    'employees',
    'constraint_rules',
    'schedule_periods',
    'schedule_period_employees',
    'schedule_imports',
    'schedule_requests',
    'previous_assignments',
    'schedule_versions',
    'schedule_assignments',
    'schedule_validation_results',
    'schedule_request_outcomes',
    'schedule_version_metrics',
    'schedule_exports',
    'schedule_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
  end loop;
end;
$migration$;

create policy department_memberships_read_own
on public.department_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  and is_active
  and deleted_at is null
);

create policy departments_read_member
on public.departments
for select
to authenticated
using (
  nurseflow_private.has_department_role(
    id,
    array['ADMIN', 'SCHEDULER', 'REVIEWER', 'VIEWER']::text[]
  )
);

create policy departments_update_admin
on public.departments
for update
to authenticated
using (
  nurseflow_private.has_department_role(id, array['ADMIN']::text[])
)
with check (
  nurseflow_private.has_department_role(id, array['ADMIN']::text[])
);

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'skill_levels',
    'shift_types',
    'employees',
    'constraint_rules',
    'schedule_periods',
    'schedule_period_employees',
    'schedule_imports',
    'schedule_requests',
    'previous_assignments',
    'schedule_versions',
    'schedule_assignments',
    'schedule_validation_results',
    'schedule_request_outcomes',
    'schedule_version_metrics',
    'schedule_exports',
    'schedule_audit_logs'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (nurseflow_private.has_department_role('
      || 'department_id, array[''ADMIN'', ''SCHEDULER'', ''REVIEWER'', ''VIEWER'']::text[]))',
      v_table || '_read_member',
      v_table
    );
  end loop;
end;
$migration$;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'skill_levels',
    'shift_types',
    'constraint_rules'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (nurseflow_private.has_department_role(department_id, array[''ADMIN'']::text[])) '
      || 'with check (nurseflow_private.has_department_role(department_id, array[''ADMIN'']::text[]))',
      v_table || '_manage_admin',
      v_table
    );
  end loop;
end;
$migration$;

create policy employees_manage_scheduler
on public.employees
for all
to authenticated
using (
  nurseflow_private.has_department_role(
    department_id,
    array['ADMIN', 'SCHEDULER']::text[]
  )
)
with check (
  nurseflow_private.has_department_role(
    department_id,
    array['ADMIN', 'SCHEDULER']::text[]
  )
);

create policy schedule_periods_manage_scheduler
on public.schedule_periods
for all
to authenticated
using (
  nurseflow_private.has_department_role(
    department_id,
    array['ADMIN', 'SCHEDULER']::text[]
  )
)
with check (
  nurseflow_private.has_department_role(
    department_id,
    array['ADMIN', 'SCHEDULER']::text[]
  )
  and status not in ('CONFIRMED', 'ARCHIVED')
  and confirmed_version_id is null
  and confirmed_at is null
  and confirmed_by is null
  and confirmed_by_nickname is null
);

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'schedule_period_employees',
    'schedule_imports',
    'schedule_requests',
    'previous_assignments'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (nurseflow_private.has_department_role('
      || 'department_id, array[''ADMIN'', ''SCHEDULER'']::text[])) '
      || 'with check (nurseflow_private.has_department_role('
      || 'department_id, array[''ADMIN'', ''SCHEDULER'']::text[]))',
      v_table || '_manage_scheduler',
      v_table
    );
  end loop;
end;
$migration$;

-- Explicit Data API grants. No anon access and no authenticated hard deletes.
grant usage on schema public to authenticated, service_role;

revoke all on table
  public.departments,
  public.department_memberships,
  public.skill_levels,
  public.shift_types,
  public.employees,
  public.constraint_rules,
  public.schedule_periods,
  public.schedule_period_employees,
  public.schedule_imports,
  public.schedule_requests,
  public.previous_assignments,
  public.schedule_versions,
  public.schedule_assignments,
  public.schedule_validation_results,
  public.schedule_request_outcomes,
  public.schedule_version_metrics,
  public.schedule_exports,
  public.schedule_audit_logs
from anon, authenticated, service_role;

grant select on table
  public.departments,
  public.department_memberships,
  public.skill_levels,
  public.shift_types,
  public.employees,
  public.constraint_rules,
  public.schedule_periods,
  public.schedule_period_employees,
  public.schedule_imports,
  public.schedule_requests,
  public.previous_assignments,
  public.schedule_versions,
  public.schedule_assignments,
  public.schedule_validation_results,
  public.schedule_request_outcomes,
  public.schedule_version_metrics,
  public.schedule_exports,
  public.schedule_audit_logs
to authenticated;

grant update on table public.departments to authenticated;
grant insert, update on table
  public.skill_levels,
  public.shift_types,
  public.employees,
  public.constraint_rules,
  public.schedule_periods,
  public.schedule_period_employees,
  public.schedule_imports,
  public.schedule_requests,
  public.previous_assignments
to authenticated;

grant all privileges on table
  public.departments,
  public.department_memberships,
  public.skill_levels,
  public.shift_types,
  public.employees,
  public.constraint_rules,
  public.schedule_periods,
  public.schedule_period_employees,
  public.schedule_imports,
  public.schedule_requests,
  public.previous_assignments,
  public.schedule_versions,
  public.schedule_assignments,
  public.schedule_validation_results,
  public.schedule_request_outcomes,
  public.schedule_version_metrics,
  public.schedule_exports,
  public.schedule_audit_logs
to service_role;

revoke all privileges on function
  public.confirm_schedule_version(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_schedule_version(uuid) to authenticated;

revoke all privileges on function
  public.confirm_schedule_version_server(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_schedule_version_server(uuid, text) to service_role;

revoke all privileges on function
  public.save_schedule_candidate(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_schedule_candidate(jsonb) to service_role;

grant usage on schema nurseflow_private to authenticated;
revoke all privileges on function
  nurseflow_private.has_department_role(uuid, text[])
from public, anon, authenticated, service_role;
grant execute on function
  nurseflow_private.has_department_role(uuid, text[])
to authenticated;

revoke all privileges on all functions in schema nurseflow_private
from public, anon, service_role;
