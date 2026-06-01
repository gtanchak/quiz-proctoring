# Runbook — environments (stand up / tear down)

How to provision, change, and destroy the dev / staging / production
environments defined under `infra/`. All commands assume Terraform `>= 1.6` and
AWS credentials for the target account (e.g. an `AWS_PROFILE`).

> **Safety:** `apply`/`destroy` create and delete real, billable AWS resources.
> Always run `terraform plan` and read it before applying. Production has
> deletion protection and a final DB snapshot — see "Tear down".

## One-time: create the state backend

The remote state lives in an S3 bucket + DynamoDB lock table created by the
`bootstrap` stack. Do this once per AWS account.

```sh
cd infra/bootstrap
terraform init
terraform apply -var "state_bucket_name=proctoring-tfstate-<unique-suffix>"
```

`state_bucket_name` must be globally unique. Note the outputs — `state_bucket`,
`lock_table`, `region` — you'll pass them to every environment's `init`.

## Stand up an environment

```sh
cd infra/environments/<env>          # dev | staging | production

terraform init \
  -backend-config="bucket=<state_bucket>" \
  -backend-config="region=<region>" \
  -backend-config="dynamodb_table=<lock_table>"

terraform plan      # review every resource it intends to create
terraform apply
```

`terraform output` then shows the VPC id, ECS cluster, DB endpoint, the DB
master-secret ARN (read from Secrets Manager — never printed), Redis endpoint,
and the evidence bucket.

The evidence bucket name is derived as
`proctoring-<env>-evidence-<account-id>`, so it is globally unique and needs no
manual input.

## Make a change

Edit the relevant module (under `infra/modules/`) or the environment's `main.tf`
sizing, then per affected environment:

```sh
terraform fmt -recursive       # from infra/
cd infra/environments/<env>
terraform validate
terraform plan                 # confirm only the intended diff
terraform apply
```

Roll changes out dev → staging → production.

## Add a new environment

1. Copy `infra/environments/dev/` to `infra/environments/<new>/`.
2. In `backend.tf`, set a unique state `key` (`env/<new>/terraform.tfstate`).
3. In `main.tf`, set `environment = "<new>"`, a non-overlapping `vpc_cidr`
   (dev `10.10`, staging `10.20`, prod `10.30` — pick the next block), and the
   sizing for that environment.
4. `terraform init` (with the backend-config flags) and `apply`.

Because each environment has its own state key and VPC CIDR, they are fully
isolated.

## Tear down an environment

```sh
cd infra/environments/<env>
terraform destroy
```

- **dev** tears down cleanly (the evidence bucket is `force_destroy`).
- **staging / production** keep the evidence bucket non-force-destroyable and
  take a final DB snapshot; **production** also has `deletion_protection` on the
  database. To destroy production you must first disable deletion protection
  (set `db_deletion_protection = false`, `apply`), then `destroy` — a
  deliberate two-step guard against accidental loss.

Never destroy `infra/bootstrap` casually: it holds every environment's state and
has `prevent_destroy` set.

## CI

PRO-51 wires `terraform fmt -check -recursive` and `terraform validate` into CI
as the automated gate, and runs `plan` against each environment on change.
