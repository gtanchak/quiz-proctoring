variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for ECS task logs."
  type        = number
  default     = 30
}
