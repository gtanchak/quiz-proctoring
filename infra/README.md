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
│   ├── storage/      # private, encrypted S3 evidence bucket
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

This issue (PRO-52) provisions the **baseline**: networking, database, cache,
object storage, and the ECS cluster. Deliberately **out of scope** (added by
later issues, layered on these same modules — do not duplicate):

- **PRO-38**: S3 lifecycle/retention rules, CloudFront CDN, SQS, CloudWatch
  alarms/monitoring.
- **PRO-51**: CI/CD that runs `terraform fmt -check` + `validate` and deploys
  the ECS services / ALB (this stack provides only the cluster they land in).

## Stack (locked — Development Architecture §2–3, §9)

AWS only: ECS Fargate, RDS PostgreSQL, S3, ElastiCache Redis, (CloudFront/SQS
later). Region defaults to `us-east-1` but must be chosen deliberately for
data-residency (PRO-44).

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
