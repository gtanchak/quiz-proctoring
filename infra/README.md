# infra/

Infrastructure-as-code (**Terraform**) for the platform. Defines the **dev**,
**staging**, and **production** environments on AWS (PRO-52). Each environment
is reproducible from code and isolated from the others (separate state,
separate VPC/database/cache/credentials).

## Layout

```
infra/
├── bootstrap/        # one-time: the shared remote-state backend (S3 + DynamoDB)
├── modules/
│   ├── network/      # VPC, public/private subnets, IGW, NAT, security groups
│   ├── database/     # RDS PostgreSQL (encrypted; AWS-managed master secret)
│   ├── cache/        # ElastiCache Redis (encryption at rest + in transit)
│   ├── storage/      # private, encrypted S3 evidence bucket (+ lifecycle, CORS)
│   ├── cdn/          # static-assets S3 bucket + CloudFront (OAC) for the SPA
│   ├── queue/        # SQS async job queue + dead-letter queue
│   ├── monitoring/   # SNS alert topic + CloudWatch alarms (RDS/Redis/CDN)
│   ├── container/    # ECS Fargate cluster, task/exec IAM roles, log group
│   └── platform/     # composition: wires the modules into one environment
└── environments/
    ├── dev/          # thin stack: provider + one `module "platform"` + sizing
    ├── staging/
    └── production/
```

**Design:** all real wiring lives in `modules/platform`; each environment is a
thin directory (provider, backend, a single `module "platform"` call with
environment-specific sizing, and outputs). This keeps logic DRY while giving
each environment its own state file and credentials — no cross-environment
blast radius.

## What's here vs. what's next

- **PRO-52** provisioned the **baseline**: networking, database, cache, the
  evidence bucket, and the ECS cluster.
- **PRO-38** (this issue) layered on the **storage/CDN/queue/monitoring** plane:
  S3 lifecycle + retention + CORS, a CloudFront CDN for the SPA static assets,
  an SQS job queue (with DLQ), CloudWatch alarms + an SNS alert topic, and the
  task-role IAM that lets services read/write evidence and use the queue. See
  the runbooks: `docs/runbooks/backups.md` and
  `docs/runbooks/storage-cdn-monitoring.md`.

Still deliberately **out of scope** (do not duplicate):

- **PRO-51 / deploy**: the CI/CD deploy of ECS **services / ALB** (this stack
  provides the cluster, task roles, log group, and now the queue/bucket IAM they
  land on). CI runs `terraform fmt -check` + `validate` only.
- Evidence **signed-URL** minting and the in-report viewer are app-level
  (core-api / PRO-27), not infrastructure.

## Stack (locked — Development Architecture §2–3, §9)

AWS only: ECS Fargate, RDS PostgreSQL, S3, ElastiCache Redis, CloudFront, SQS.
Region defaults to `us-east-1` but must be chosen deliberately for data-residency
(PRO-44) — see `docs/runbooks/storage-cdn-monitoring.md`.

## Conventions

- **No secrets in code.** The RDS master password is AWS-managed in Secrets
  Manager (`manage_master_user_password`) and never appears in source or state.
  Applications read the secret ARN (an output) at deploy time.
- Encryption at rest is on for RDS, Redis, and S3; Redis also encrypts in
  transit; the evidence bucket blocks all public access.
- Local state, provider plugins, and plans are git-ignored; committed `.tfvars`
  contain no secrets.

## Quick start

See **`docs/runbooks/environments.md`** for the full stand-up / tear-down /
add-an-environment procedure. In short:

```sh
# 1) one-time, per AWS account: create the state backend
cd infra/bootstrap && terraform init && terraform apply \
  -var "state_bucket_name=proctoring-tfstate-<unique-suffix>"

# 2) per environment, using the bootstrap outputs
cd infra/environments/dev
terraform init \
  -backend-config="bucket=<state_bucket>" \
  -backend-config="region=<region>" \
  -backend-config="dynamodb_table=<lock_table>"
terraform plan    # review; apply when ready
```

`terraform fmt -recursive` and `terraform validate` should pass for every stack.
