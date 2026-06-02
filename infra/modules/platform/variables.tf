variable "environment" {
  description = "Environment name (dev | staging | production)."
  type        = string
}

variable "project" {
  description = "Project name, used in the resource name prefix."
  type        = string
  default     = "proctoring"
}

variable "evidence_bucket_name" {
  description = "Globally-unique name for the evidence S3 bucket."
  type        = string
}

# --- Networking -------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones."
  type        = number
  default     = 2
}

variable "nat_gateway_count" {
  description = "Number of NAT gateways (1 non-prod, one per AZ for prod)."
  type        = number
  default     = 1
}

# --- Database ---------------------------------------------------------------
variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Initial DB storage (GiB)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Max DB storage for autoscaling (GiB)."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Run the database Multi-AZ."
  type        = bool
  default     = false
}

variable "db_backup_retention_period" {
  description = "Days of automated DB backups."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Protect the database from deletion."
  type        = bool
  default     = false
}

variable "db_skip_final_snapshot" {
  description = "Skip the final DB snapshot on destroy."
  type        = bool
  default     = true
}

# --- Cache ------------------------------------------------------------------
variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_clusters" {
  description = "Number of Redis nodes."
  type        = number
  default     = 1
}

variable "redis_multi_az" {
  description = "Enable Redis Multi-AZ with automatic failover."
  type        = bool
  default     = false
}

# --- Container --------------------------------------------------------------
variable "log_retention_days" {
  description = "CloudWatch log retention for ECS logs."
  type        = number
  default     = 30
}

variable "evidence_bucket_force_destroy" {
  description = "Allow deleting a non-empty evidence bucket (dev only)."
  type        = bool
  default     = false
}

# --- Evidence lifecycle / CORS (PRO-38) -------------------------------------
variable "evidence_retention_days" {
  description = "Expire current evidence objects after N days (0 = keep indefinitely)."
  type        = number
  default     = 0
}

variable "evidence_noncurrent_version_retention_days" {
  description = "Days to keep noncurrent evidence versions."
  type        = number
  default     = 30
}

variable "evidence_cors_allowed_origins" {
  description = "Origins allowed to upload evidence via signed URLs (empty = no CORS)."
  type        = list(string)
  default     = []
}

# --- CDN / static assets (PRO-38) -------------------------------------------
variable "assets_bucket_name" {
  description = "Globally-unique name for the static-assets (SPA) S3 bucket."
  type        = string
}

variable "assets_bucket_force_destroy" {
  description = "Allow deleting a non-empty assets bucket (dev only)."
  type        = bool
  default     = false
}

variable "cdn_price_class" {
  description = "CloudFront price class for the static-assets distribution."
  type        = string
  default     = "PriceClass_100"
}

# --- Monitoring (PRO-38) ----------------------------------------------------
variable "alarm_email" {
  description = "Email subscribed to the alerts SNS topic (empty = no subscription)."
  type        = string
  default     = ""
}
