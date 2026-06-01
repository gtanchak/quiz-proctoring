variable "region" {
  description = "AWS region for this environment. Choose deliberately for data-residency (PRO-44)."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name, used in resource name prefixes."
  type        = string
  default     = "proctoring"
}
