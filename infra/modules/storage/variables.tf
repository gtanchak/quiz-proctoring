variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "bucket_name" {
  description = <<-EOT
    Globally-unique name for the evidence bucket (snapshots, audio, ID images).
    S3 bucket names are global, so pass an explicit, account-unique value.
  EOT
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform to delete a non-empty bucket (only ever enable in dev)."
  type        = bool
  default     = false
}
