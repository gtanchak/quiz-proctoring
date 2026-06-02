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

# --- Lifecycle / retention (PRO-38) -----------------------------------------
variable "retention_days" {
  description = <<-EOT
    Expire current evidence objects this many days after creation. 0 disables
    expiry (keep indefinitely). Retention is a deliberate compliance choice
    (PRO-44) — production keeps evidence; short-lived envs expire it.
  EOT
  type        = number
  default     = 0
}

variable "noncurrent_version_retention_days" {
  description = "Days to keep noncurrent object versions before expiring them (bounds version sprawl from overwrites)."
  type        = number
  default     = 30
}

# --- CORS (PRO-38) ----------------------------------------------------------
variable "cors_allowed_origins" {
  description = <<-EOT
    Origins allowed to PUT/GET directly against the bucket via signed URLs (the
    browser snapshot upload path, PRO-15). Empty disables CORS entirely.
  EOT
  type        = list(string)
  default     = []
}
