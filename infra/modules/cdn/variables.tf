variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "assets_bucket_name" {
  description = "Globally-unique name for the static-assets S3 bucket (the SPA build output)."
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform to delete a non-empty assets bucket (only ever enable in dev)."
  type        = bool
  default     = false
}

variable "price_class" {
  description = "CloudFront price class (edge-location coverage vs. cost). E.g. PriceClass_100 | PriceClass_200 | PriceClass_All."
  type        = string
  default     = "PriceClass_100"
}
