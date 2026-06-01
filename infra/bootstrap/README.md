# infra/bootstrap

Creates the **shared Terraform state backend** — an S3 bucket (versioned,
encrypted, private) for remote state and a DynamoDB table for state locking.

This stack uses **local state** on purpose: it builds the backend that every
other stack relies on, so it cannot itself use a remote backend (chicken and
egg). Run it **once per AWS account**, before initialising any environment.

## Usage

```sh
cd infra/bootstrap
terraform init
terraform apply -var "state_bucket_name=proctoring-tfstate-<unique-suffix>"
```

`state_bucket_name` must be globally unique across all of AWS — pick a stable,
account-specific suffix and keep it.

The outputs (`state_bucket`, `lock_table`, `region`) are the values each
environment puts in its `backend.tf`.

## Notes

- The state bucket has `prevent_destroy` set — destroying it would orphan every
  environment's state. Removing it is a deliberate, manual operation.
- Commit the resulting `backend.tf` values, never the local `terraform.tfstate`
  produced here (it is git-ignored).
