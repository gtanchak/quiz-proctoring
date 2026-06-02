variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "alarm_email" {
  description = "Email subscribed to the alerts topic. Empty = no subscription (wire one in via ops/secrets)."
  type        = string
  default     = ""
}

# --- Alarm targets ----------------------------------------------------------
variable "db_instance_id" {
  description = "RDS instance identifier (DBInstanceIdentifier dimension)."
  type        = string
}

variable "redis_replication_group_id" {
  description = "ElastiCache replication group id; the primary node is <id>-001."
  type        = string
}

variable "cdn_distribution_id" {
  description = "CloudFront distribution id for the 5xx error-rate alarm."
  type        = string
}

# --- Thresholds -------------------------------------------------------------
variable "db_cpu_threshold" {
  description = "RDS CPU utilization (%) above which to alarm."
  type        = number
  default     = 80
}

variable "db_free_storage_bytes_threshold" {
  description = "RDS free storage (bytes) below which to alarm. Default 2 GiB."
  type        = number
  default     = 2147483648
}

variable "db_freeable_memory_bytes_threshold" {
  description = "RDS freeable memory (bytes) below which to alarm. Default 128 MiB."
  type        = number
  default     = 134217728
}

variable "redis_cpu_threshold" {
  description = "Redis engine CPU utilization (%) above which to alarm."
  type        = number
  default     = 80
}

variable "cdn_5xx_threshold" {
  description = "CloudFront 5xx error rate (%) above which to alarm."
  type        = number
  default     = 5
}
