# Partial backend config — see docs/runbooks/environments.md. Supply
# bucket/region/dynamodb_table (infra/bootstrap outputs) at `terraform init`.
terraform {
  backend "s3" {
    key     = "env/staging/terraform.tfstate"
    encrypt = true
  }
}
