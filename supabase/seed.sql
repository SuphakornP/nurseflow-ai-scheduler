-- Synthetic NurseFlow showcase data. No legal names, employee numbers, emails,
-- or other real-world identifiers are stored in application tables.

insert into public.departments (id, code, name, timezone)
values (
  '10000000-0000-4000-8000-000000000001',
  'MICU',
  'Medical ICU Showcase',
  'Asia/Bangkok'
)
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name,
  timezone = excluded.timezone,
  is_active = true;

insert into public.skill_levels (
  id,
  department_id,
  code,
  name,
  sort_order,
  is_incharge_capable,
  is_trainee,
  is_emergency_only
)
values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'INCHARGE', 'Incharge', 1, true, false, false),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'TRAINEE_INC', 'Trainee Incharge', 2, true, true, false),
  ('11000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'MEMBER_L1', 'Member Level 1', 3, false, false, false),
  ('11000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'MEMBER_L2', 'Member Level 2', 4, false, false, false),
  ('11000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'MEMBER_L0', 'Member Level 0', 5, false, false, true)
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_incharge_capable = excluded.is_incharge_capable,
  is_trainee = excluded.is_trainee,
  is_emergency_only = excluded.is_emergency_only,
  is_active = true;

insert into public.shift_types (
  id,
  department_id,
  code,
  name,
  category,
  hours,
  is_working_shift,
  is_locked_request,
  sort_order
)
values
  ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'D', 'Day', 'WORK', 12, true, false, 1),
  ('12000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'N', 'Night', 'WORK', 12, true, false, 2),
  ('12000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'OFF', 'Off', 'OFF', 0, false, false, 3),
  ('12000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'VAC', 'Vacation', 'LEAVE', 0, false, true, 4),
  ('12000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'ED', 'Education', 'EDUCATION', 8, false, true, 5)
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name,
  category = excluded.category,
  hours = excluded.hours,
  is_working_shift = excluded.is_working_shift,
  is_locked_request = excluded.is_locked_request,
  sort_order = excluded.sort_order,
  is_active = true;

with employee_seed (ordinal, nickname, skill_code, max_clinical_shifts) as (
  values
    (1, 'Mint', 'INCHARGE', null::smallint),
    (2, 'Beam', 'INCHARGE', null::smallint),
    (3, 'Ploy', 'INCHARGE', null::smallint),
    (4, 'Fah', 'INCHARGE', null::smallint),
    (5, 'May', 'INCHARGE', null::smallint),
    (6, 'Nan', 'INCHARGE', null::smallint),
    (7, 'Aom', 'INCHARGE', null::smallint),
    (8, 'Gift', 'INCHARGE', null::smallint),
    (9, 'Pear', 'TRAINEE_INC', null::smallint),
    (10, 'Praew', 'TRAINEE_INC', null::smallint),
    (11, 'Mook', 'TRAINEE_INC', null::smallint),
    (12, 'Bam', 'TRAINEE_INC', null::smallint),
    (13, 'June', 'MEMBER_L1', null::smallint),
    (14, 'Fern', 'MEMBER_L1', null::smallint),
    (15, 'Mind', 'MEMBER_L1', null::smallint),
    (16, 'Ice', 'MEMBER_L1', null::smallint),
    (17, 'View', 'MEMBER_L1', null::smallint),
    (18, 'Noon', 'MEMBER_L1', null::smallint),
    (19, 'Ning', 'MEMBER_L1', null::smallint),
    (20, 'Bow', 'MEMBER_L1', null::smallint),
    (21, 'Earn', 'MEMBER_L1', null::smallint),
    (22, 'Kwan', 'MEMBER_L1', null::smallint),
    (23, 'Som', 'MEMBER_L1', null::smallint),
    (24, 'Fon', 'MEMBER_L2', null::smallint),
    (25, 'Pim', 'MEMBER_L2', null::smallint),
    (26, 'Oil', 'MEMBER_L2', null::smallint),
    (27, 'Dao', 'MEMBER_L2', null::smallint),
    (28, 'Jan', 'MEMBER_L0', 7::smallint)
)
insert into public.employees (
  id,
  department_id,
  skill_level_id,
  nickname,
  employment_status,
  max_monthly_clinical_shifts,
  effective_start_date,
  is_synthetic
)
select
  ('20000000-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  skill.id,
  seed.nickname,
  'ACTIVE',
  seed.max_clinical_shifts,
  date '2026-01-01',
  true
from employee_seed as seed
join public.skill_levels as skill
  on skill.department_id = '10000000-0000-4000-8000-000000000001'::uuid
 and skill.code = seed.skill_code
on conflict (id) do update
set
  skill_level_id = excluded.skill_level_id,
  nickname = excluded.nickname,
  employment_status = excluded.employment_status,
  max_monthly_clinical_shifts = excluded.max_monthly_clinical_shifts,
  effective_start_date = excluded.effective_start_date,
  is_synthetic = true,
  is_active = true;

with rule_seed (ordinal, code, name, rule_type, priority_order, penalty_weight, rule_config) as (
  values
    (1, 'SINGLE_COMPLETE_ASSIGNMENT', 'Exactly one assignment per nurse and date', 'HARD', 1, null::numeric, '{"exactly_one":true}'::jsonb),
    (2, 'DAY_STAFFING', 'Daily Day staffing', 'HARD', 2, null::numeric, '{"required":10}'::jsonb),
    (3, 'NIGHT_STAFFING', 'Daily Night staffing', 'HARD', 3, null::numeric, '{"required":9}'::jsonb),
    (4, 'SKILL_MIX', 'Per-shift skill ranges', 'HARD', 4, null::numeric, '{"INCHARGE":[2,3],"TRAINEE_INC":[1,2],"MEMBER_L1":[2,5],"MEMBER_L2":[1,3],"MEMBER_L0":[0,1]}'::jsonb),
    (5, 'FORBIDDEN_SKILL_MIX', 'Forbidden Incharge plus Trainee and L2 mix', 'HARD', 5, null::numeric, '{"senior_total":3,"member_l2_forbidden":3}'::jsonb),
    (6, 'NORMALIZATION_RESOLVED', 'All request values are human-resolved', 'HARD', 6, null::numeric, '{}'::jsonb),
    (7, 'VACATION_PRESERVED', 'Approved Vacation is immutable', 'HARD', 7, null::numeric, '{}'::jsonb),
    (8, 'EDUCATION_PRESERVED', 'Explicit Education is immutable', 'HARD', 8, null::numeric, '{}'::jsonb),
    (9, 'FIXED_CLINICAL_PRESERVED', 'Explicit Day and Night are immutable', 'HARD', 9, null::numeric, '{}'::jsonb),
    (10, 'FLEXIBLE_ASSIGNMENT_ALLOWED', 'Flexible requests use allowed assignments', 'HARD', 10, null::numeric, '{}'::jsonb),
    (11, 'MAX_CONSECUTIVE_DAY', 'No more than three consecutive Day shifts', 'HARD', 11, null::numeric, '{"maximum":3}'::jsonb),
    (12, 'MAX_CONSECUTIVE_NIGHT', 'No more than three consecutive Night shifts', 'HARD', 12, null::numeric, '{"maximum":3}'::jsonb),
    (13, 'MAX_CONSECUTIVE_CLINICAL', 'No more than five consecutive clinical shifts', 'HARD', 13, null::numeric, '{"maximum":5}'::jsonb),
    (14, 'NIGHT_TO_DAY', 'Night may not be followed by Day', 'HARD', 14, null::numeric, '{"forbidden":["N","D"]}'::jsonb),
    (15, 'NIGHT_TO_EDUCATION', 'Night may not be followed by Education', 'HARD', 15, null::numeric, '{"forbidden":["N","ED"]}'::jsonb),
    (16, 'MAX_CONSECUTIVE_OFF_VACATION', 'No more than seven consecutive OFF or Vacation days', 'HARD', 16, null::numeric, '{"maximum":7}'::jsonb),
    (17, 'MEMBER_L0_LIMIT', 'Member L0 monthly clinical shift limit', 'HARD', 17, null::numeric, '{"maximum":7}'::jsonb),
    (18, 'OFF_PRIORITY', 'Preserve higher-priority OFF requests', 'SOFT', 18, 1000::numeric, '{"O1":10000,"O2":5000,"O3":2000,"O4":1000}'::jsonb),
    (19, 'CONSECUTIVE_OFF', 'Prefer consecutive OFF days', 'SOFT', 19, 500::numeric, '{"prefer_blocks":true}'::jsonb),
    (20, 'MINIMIZE_MEMBER_L0', 'Minimize Member L0 clinical use', 'SOFT', 20, 300::numeric, '{}'::jsonb),
    (21, 'BALANCE_DAY', 'Balance Day assignments', 'SOFT', 21, 100::numeric, '{}'::jsonb),
    (22, 'BALANCE_NIGHT', 'Balance Night assignments', 'SOFT', 22, 100::numeric, '{}'::jsonb),
    (23, 'BALANCE_WEEKEND', 'Balance weekend assignments', 'SOFT', 23, 50::numeric, '{} '::jsonb)
)
insert into public.constraint_rules (
  id,
  department_id,
  code,
  name,
  rule_type,
  rule_config,
  priority_order,
  penalty_weight,
  effective_start_date
)
select
  ('30000000-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  seed.code,
  seed.name,
  seed.rule_type,
  seed.rule_config,
  seed.priority_order,
  seed.penalty_weight,
  date '2026-01-01'
from rule_seed as seed
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name,
  rule_type = excluded.rule_type,
  rule_config = excluded.rule_config,
  priority_order = excluded.priority_order,
  penalty_weight = excluded.penalty_weight,
  effective_start_date = excluded.effective_start_date,
  is_active = true;

insert into public.schedule_periods (
  id,
  department_id,
  code,
  name,
  schedule_start_date,
  schedule_end_date,
  context_start_date,
  context_end_date,
  status
)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'MICU-2026-08',
  'MICU August 2026 Showcase',
  date '2026-08-01',
  date '2026-08-31',
  date '2026-07-29',
  date '2026-07-31',
  'READY'
)
on conflict (id) do nothing;

with ranked_employee as (
  select
    employee.*,
    row_number() over (order by employee.id)::integer as ordinal,
    skill.code as skill_code
  from public.employees as employee
  join public.skill_levels as skill
    on skill.id = employee.skill_level_id
   and skill.department_id = employee.department_id
  where employee.department_id = '10000000-0000-4000-8000-000000000001'::uuid
    and employee.is_synthetic
    and employee.is_active
    and employee.deleted_at is null
)
insert into public.schedule_period_employees (
  id,
  department_id,
  schedule_period_id,
  employee_id,
  nickname_snapshot,
  skill_level_code_snapshot,
  max_clinical_shifts,
  is_available_for_period
)
select
  ('50000000-0000-4000-8000-' || lpad(employee.ordinal::text, 12, '0'))::uuid,
  employee.department_id,
  '40000000-0000-4000-8000-000000000001'::uuid,
  employee.id,
  employee.nickname,
  employee.skill_code,
  employee.max_monthly_clinical_shifts,
  true
from ranked_employee as employee
on conflict do nothing;

insert into public.schedule_imports (
  id,
  department_id,
  schedule_period_id,
  source_type,
  original_filename,
  import_status,
  raw_snapshot,
  imported_at
)
values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'MANUAL_ENTRY',
  'synthetic-showcase-input.xlsx',
  'NORMALIZED',
  '{"privacy_mode":"NICKNAME_ONLY","synthetic":true,"employee_count":28}'::jsonb,
  now()
)
on conflict (id) do nothing;

with period_employee as (
  select
    snapshot.id,
    snapshot.department_id,
    snapshot.schedule_period_id,
    row_number() over (order by snapshot.id)::integer as ordinal
  from public.schedule_period_employees as snapshot
  where snapshot.schedule_period_id = '40000000-0000-4000-8000-000000000001'::uuid
    and snapshot.is_active
    and snapshot.deleted_at is null
),
context_date as (
  select date_value::date as assignment_date, date_ordinal::integer
  from generate_series(date '2026-07-29', date '2026-07-31', interval '1 day')
    with ordinality as generated(date_value, date_ordinal)
),
context_assignment as (
  select
    employee.*,
    day.assignment_date,
    case mod(employee.ordinal - 1, 5)
      when 0 then (array['OFF', 'D', 'D']::text[])[day.date_ordinal]
      when 1 then (array['OFF', 'N', 'N']::text[])[day.date_ordinal]
      when 2 then (array['D', 'OFF', 'D']::text[])[day.date_ordinal]
      when 3 then (array['N', 'OFF', 'N']::text[])[day.date_ordinal]
      else (array['OFF', 'OFF', 'OFF']::text[])[day.date_ordinal]
    end as shift_code
  from period_employee as employee
  cross join context_date as day
)
insert into public.previous_assignments (
  id,
  department_id,
  schedule_period_id,
  period_employee_id,
  shift_type_id,
  schedule_import_id,
  assignment_date
)
select
  md5(assignment.id::text || assignment.assignment_date::text)::uuid,
  assignment.department_id,
  assignment.schedule_period_id,
  assignment.id,
  shift.id,
  '60000000-0000-4000-8000-000000000001'::uuid,
  assignment.assignment_date
from context_assignment as assignment
join public.shift_types as shift
  on shift.department_id = assignment.department_id
 and shift.code = assignment.shift_code
on conflict do nothing;

with period_employee as (
  select
    snapshot.id,
    snapshot.department_id,
    snapshot.schedule_period_id,
    snapshot.nickname_snapshot as nickname,
    row_number() over (order by snapshot.id)::integer as ordinal
  from public.schedule_period_employees as snapshot
  where snapshot.schedule_period_id = '40000000-0000-4000-8000-000000000001'::uuid
    and snapshot.is_active
    and snapshot.deleted_at is null
),
base_request as (
  select
    employee.ordinal,
    employee.nickname,
    make_date(2026, 8, mod((employee.ordinal - 1) * 5 + priority * 7, 31) + 1) as request_date,
    'O' || priority::text as raw_value
  from period_employee as employee
  cross join generate_series(1, 4) as generated(priority)
),
conflict_request (ordinal, request_date, raw_value) as (
  values
    (1, date '2026-08-14', 'O1'),
    (2, date '2026-08-14', 'O1'),
    (3, date '2026-08-14', 'O2'),
    (4, date '2026-08-14', 'O2'),
    (5, date '2026-08-14', 'O3'),
    (6, date '2026-08-14', 'O3'),
    (7, date '2026-08-14', 'O4'),
    (8, date '2026-08-14', 'O4'),
    (9, date '2026-08-22', 'O1'),
    (10, date '2026-08-22', 'O2'),
    (11, date '2026-08-22', 'O3'),
    (12, date '2026-08-22', 'O4')
),
request_with_conflicts as (
  select base.*
  from base_request as base
  where not exists (
    select 1
    from conflict_request as conflict
    where conflict.ordinal = base.ordinal
      and conflict.request_date = base.request_date
  )
  union all
  select
    conflict.ordinal,
    employee.nickname,
    conflict.request_date,
    conflict.raw_value
  from conflict_request as conflict
  join period_employee as employee using (ordinal)
),
locked_event (ordinal, request_date, raw_value) as (
  values
    (1, date '2026-08-06', 'Vac'),
    (9, date '2026-08-11', 'VAC'),
    (17, date '2026-08-17', 'vac'),
    (25, date '2026-08-23', 'Vac'),
    (4, date '2026-08-09', 'ED'),
    (21, date '2026-08-14', 'ชED'),
    (11, date '2026-08-20', 'O/D'),
    (26, date '2026-08-27', 'N/O')
),
final_request as (
  select request.*
  from request_with_conflicts as request
  where not exists (
    select 1
    from locked_event as event
    where event.ordinal = request.ordinal
      and event.request_date = request.request_date
  )
  union all
  select
    event.ordinal,
    employee.nickname,
    event.request_date,
    event.raw_value
  from locked_event as event
  join period_employee as employee using (ordinal)
),
request_seed as (
  select
    request.nickname,
    request.request_date,
    request.raw_value,
    case
      when lower(request.raw_value) = 'vac' then 'VACATION'
      when request.raw_value in ('ED', 'ชED') then 'EDUCATION'
      when request.raw_value = 'O/D' then 'OFF_OR_DAY'
      when request.raw_value = 'N/O' then 'OFF_OR_NIGHT'
      else 'OFF_REQUEST'
    end as normalized_type,
    case
      when request.raw_value ~ '^O[1-4]$' then substring(request.raw_value from 2 for 1)::smallint
      else null::smallint
    end as priority,
    lower(request.raw_value) = 'vac' or request.raw_value in ('ED', 'ชED') as is_locked,
    case
      when lower(request.raw_value) = 'vac' then array['VAC']::text[]
      when request.raw_value in ('ED', 'ชED') then array['ED']::text[]
      when request.raw_value = 'O/D' then array['OFF', 'D']::text[]
      when request.raw_value = 'N/O' then array['OFF', 'N']::text[]
      else array['OFF']::text[]
    end as allowed_assignments,
    case
      when lower(request.raw_value) = 'vac' or request.raw_value in ('ED', 'ชED') then 'CONFIRMED'
      else 'NORMALIZED'
    end as normalization_status,
    case
      when lower(request.raw_value) = 'vac' then 'VAC'
      when request.raw_value in ('ED', 'ชED') then 'ED'
      else null::text
    end as confirmed_value,
    1.000::numeric as confidence
  from final_request as request
)
insert into public.schedule_requests (
  id,
  department_id,
  schedule_period_id,
  schedule_import_id,
  period_employee_id,
  request_date,
  raw_value,
  normalized_type,
  priority,
  is_locked,
  allowed_assignments,
  normalization_status,
  confirmed_value,
  confidence
)
select
  md5(seed.nickname || seed.request_date::text || seed.raw_value)::uuid,
  snapshot.department_id,
  snapshot.schedule_period_id,
  '60000000-0000-4000-8000-000000000001'::uuid,
  snapshot.id,
  seed.request_date,
  seed.raw_value,
  seed.normalized_type,
  seed.priority,
  seed.is_locked,
  seed.allowed_assignments,
  seed.normalization_status,
  seed.confirmed_value,
  seed.confidence
from request_seed as seed
join public.schedule_period_employees as snapshot
  on snapshot.schedule_period_id = '40000000-0000-4000-8000-000000000001'::uuid
 and snapshot.nickname_snapshot = seed.nickname
 and snapshot.is_active
 and snapshot.deleted_at is null
on conflict do nothing;

-- Membership is attached only when a synthetic local Auth user was created
-- through the supported Auth API. The seed never mutates auth.users directly.
insert into public.department_memberships (
  id,
  department_id,
  user_id,
  member_nickname,
  role
)
select
  '90000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  auth_user.id,
  coalesce(nullif(auth_user.raw_user_meta_data ->> 'nickname', ''), 'Demo Scheduler'),
  'ADMIN'
from auth.users as auth_user
where auth_user.email = 'demo@nurseflow.local'
on conflict do nothing;
