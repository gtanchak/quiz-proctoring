# Runbook: evidence storage, CDN, queue & monitoring

The storage/CDN/queue/observability plane added in PRO-38, layered on the PRO-52
baseline. Database backups are in `backups.md`; environment stand-up is in
`environments.md`.

## Evidence object storage (`modules/storage`)

The private evidence bucket holds webcam snapshots, audio, and ID images.

- **Private, always.** Public access fully blocked; encrypted at rest (SSE-S3);
  versioned. Evidence is read **only** via signed, time-limited S3 URLs minted by
  core-api — it is **never** placed behind the public CDN.
- **Lifecycle** (`aws_s3_bucket_lifecycle_configuration`):
  - Noncurrent versions expire after `evidence_noncurrent_version_retention_days`
    (dev 7 / staging 30 / prod 90).
  - Incomplete multipart uploads are aborted after 7 days.
  - Current objects expire only if `evidence_retention_days > 0` (dev 7; staging
    and prod keep evidence indefinitely — it is evidence for human review).
- **CORS** (`evidence_cors_allowed_origins`): allows the browser signed-URL
  upload path (PRO-15) to `PUT`/`GET` directly. Dev allows `localhost:5173/5174`.
  **Set staging/production to the real app origin once the domain exists** —
  until then the list is empty and no CORS rule is created (browser uploads would
  be blocked).
- **Write access**: the ECS task role gets `s3:PutObject/GetObject/DeleteObject`
  on the bucket (wired in `modules/platform`), so the evidence pipelines
  (PRO-15 / PRO-27 / PRO-29) can write once deployed.

## CDN for static assets (`modules/cdn`)

A CloudFront distribution serves the candidate/admin **SPA** from a private S3
origin via Origin Access Control (OAC).

- The assets bucket stays private; CloudFront is the only public reader (enforced
  by a bucket policy scoped to the distribution ARN).
- SPA routing: 403/404 from S3 are rewritten to `/index.html` (200) so
  client-side routes resolve.
- `cdn_price_class`: dev/staging `PriceClass_100`; production `PriceClass_All`.
- A custom domain + ACM certificate is a follow-up; the default
  `*.cloudfront.net` domain is used for now.

**Deploy the SPA**: upload the Vite build to the `assets_bucket` output, then
invalidate the cache:

```sh
aws s3 sync apps/candidate-web/dist "s3://$(terraform -chdir=infra/environments/<env> output -raw assets_bucket)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=infra/environments/<env> output -raw cdn_distribution_id)" \
  --paths '/*'
```

## Async job queue (`modules/queue`)

An SQS queue (`<prefix>-jobs`) with a dead-letter queue (`<prefix>-jobs-dlq`) for
out-of-band work (CV inference, evidence post-processing) so the candidate flow
never blocks (CLAUDE.md §5). SSE enabled; messages redrive to the DLQ after
`max_receive_count` (5) failed deliveries. The task role can
send/receive/delete on both queues.

Watch the DLQ depth — a non-zero DLQ means a worker is failing repeatedly.

## Monitoring & alerting (`modules/monitoring`)

An SNS topic (`<prefix>-alerts`) plus baseline CloudWatch alarms:

| Alarm | Metric | Default threshold |
| -- | -- | -- |
| DB CPU high | RDS `CPUUtilization` | > 80% (3×5m) |
| DB free storage low | RDS `FreeStorageSpace` | < 2 GiB |
| DB freeable memory low | RDS `FreeableMemory` | < 128 MiB |
| Redis CPU high | ElastiCache `EngineCPUUtilization` | > 80% |
| CDN 5xx high | CloudFront `5xxErrorRate` | > 5% |

- Subscribe an endpoint by setting `alarm_email` (per environment). Left empty,
  alarms still fire to the topic but nobody is paged — wire the on-call address
  via ops before relying on it.
- CloudFront publishes metrics only to **us-east-1**; the CDN alarm assumes the
  environment region is us-east-1 (the project default).
- ECS Container Insights is already on (PRO-52); service-level alarms land with
  the deploy pipeline.

## Data residency (interacts with PRO-44)

All environments default to **`us-east-1`** (`region` in each env's
`terraform.tfvars`). Per AutoProctor's stance, evidence — webcam/ID/biometric
data — is stored in-region. Changing the region is a deliberate compliance
decision: pick it **before** first apply (moving data across regions later is
costly and has legal implications). Document the chosen region with the PRO-44
compliance work.
