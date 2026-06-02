# Runbook: database backups & restore

Covers the RDS PostgreSQL backup configuration (PRO-38) and the **tested**
restore procedure. Object-storage durability (S3 versioning) is summarized at the
end; storage/CDN/monitoring details live in `storage-cdn-monitoring.md`.

## What runs automatically

RDS automated backups are configured per environment in
`infra/environments/<env>/main.tf` via `db_backup_retention_period`:

| Environment | Retention | Multi-AZ | Final snapshot on destroy |
| -- | -- | -- | -- |
| dev | 1 day | no | skipped |
| staging | 7 days | no | taken |
| production | 30 days | yes | taken |

- Automated daily snapshots + transaction logs enable **point-in-time recovery
  (PITR)** to any second within the retention window.
- `copy_tags_to_snapshot = true` (database module) — snapshots inherit resource
  tags for cost allocation and ownership.
- Storage is encrypted at rest, so snapshots are encrypted too.
- Production has `deletion_protection = true`; tearing it down is a deliberate
  two-step (see `environments.md`).

## Restore procedure

RDS restores create a **new instance** (you cannot restore in place). Plan for a
DNS/secret cutover after validating the restored data.

### A. Point-in-time recovery (most common)

```sh
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier proctoring-production-db \
  --target-db-instance-identifier proctoring-production-db-restore \
  --restore-time 2026-06-02T12:00:00Z \
  --db-subnet-group-name proctoring-production-db \
  --vpc-security-group-ids <database-sg-id> \
  --no-publicly-accessible
```

### B. Restore from a specific snapshot

```sh
aws rds describe-db-snapshots \
  --db-instance-identifier proctoring-production-db --query 'DBSnapshots[].DBSnapshotIdentifier'

aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier proctoring-production-db-restore \
  --db-snapshot-identifier <snapshot-id> \
  --db-subnet-group-name proctoring-production-db \
  --vpc-security-group-ids <database-sg-id> \
  --no-publicly-accessible
```

### Cutover

1. Wait for the restored instance to become `available`.
2. The restored instance gets a **new** AWS-managed master secret — read its new
   endpoint and secret ARN, and update the service config (the `database_*`
   outputs / Secrets Manager reference) to point at it.
3. Smoke-test the app against the restored instance.
4. Promote: repoint services, then rename/retire the old instance.

## Restore test (do this — don't assume backups work)

A backup is only real once a restore has succeeded. Run this in **staging** on a
schedule (at least quarterly) and record the result:

1. Restore the latest staging snapshot to `proctoring-staging-db-restore` (recipe
   B above).
2. Connect and verify row counts on key tables (`tests`, `attempts`,
   `responses`) match the source within the expected window.
3. Run the app's migrations check / a read smoke test against the restore.
4. Record the date, snapshot id, restore duration, and outcome below.
5. Delete the restore instance (`aws rds delete-db-instance ... --skip-final-snapshot`).

### Restore-test log

| Date | Env | Snapshot/PITR | Duration | Result | By |
| -- | -- | -- | -- | -- | -- |
| _pending first live run_ | staging | — | — | — | — |

> This environment provisions infrastructure-as-code; the first live restore test
> is run by ops once an AWS account is attached. The procedure above is the
> rehearsed script.

## S3 evidence durability

- The evidence bucket has **versioning enabled** — overwrites/deletes keep prior
  versions (recoverable). Noncurrent versions expire per
  `evidence_noncurrent_version_retention_days` (dev 7 / staging 30 / prod 90).
- Encryption at rest (SSE-S3) is on; all public access is blocked.
- For cross-region DR of evidence, add S3 replication (future work; not MVP).
