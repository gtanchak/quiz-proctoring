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
