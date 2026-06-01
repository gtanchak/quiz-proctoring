variable "region" {
  description = "AWS region that holds the shared Terraform state backend."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name, used to tag and name the backend resources."
  type        = string
  default     = "proctoring"
}

variable "state_bucket_name" {
  description = <<-EOT
    Globally-unique S3 bucket name for remote Terraform state. S3 bucket names
    are global, so this must be unique across all of AWS — set it explicitly
    (e.g. "proctoring-tfstate-<account-or-org-suffix>").
  EOT
  type        = string
}

variable "lock_table_name" {
  description = "DynamoDB table name used for Terraform state locking."
  type        = string
  default     = "proctoring-tflock"
}
