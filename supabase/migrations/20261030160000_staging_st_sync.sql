-- Staging rework (Chris, 2026-10-30): jobs auto-pull from ServiceTitan and
-- walk needs_parts → parts_ordered → parts_arrived → scheduled → done.
-- done drops off the list; a job completed/canceled in ServiceTitan is set
-- done automatically by the sync.
alter table inventory.staging_jobs
  add column st_job_id bigint,
  add column st_job_number text not null default '',
  add column st_job_status text not null default '',
  add column auto_pulled integer not null default 0;

create unique index staging_jobs_st_job_id_key on inventory.staging_jobs (st_job_id) where st_job_id is not null;

update inventory.staging_jobs set status = case status
  when 'needed' then 'needs_parts'
  when 'picking' then 'parts_ordered'
  when 'staged' then 'parts_arrived'
  when 'loaded' then 'scheduled'
  else 'done'
end;
