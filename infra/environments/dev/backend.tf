# Partial backend config: the static parts live here; the account-specific
# bucket/region/lock-table (outputs of infra/bootstrap) are supplied at init:
#
#   terraform init \
#     -backend-config="bucket=<state_bucket>" \
#     -backend-config="region=<region>" \
#     -backend-config="dynamodb_table=<lock_table>"
#
# See docs/runbooks/environments.md.
terraform {
  backend "s3" {
    key     = "env/dev/terraform.tfstate"
    encrypt = true
  }
}
