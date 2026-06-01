variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the DB subnet group."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group id controlling access to the database."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major/minor version."
  type        = string
  default     = "15"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Initial storage (GiB)."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Upper bound for storage autoscaling (GiB)."
  type        = number
  default     = 100
}

variable "multi_az" {
  description = "Run a standby in a second AZ (recommended for production)."
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Days of automated backups to retain."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Block accidental deletion of the instance (enable in production)."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot on destroy. Set false for production."
  type        = bool
  default     = true
}

variable "database_name" {
  description = "Initial database name."
  type        = string
  default     = "proctoring"
}

variable "master_username" {
  description = "Master username. The password is generated and stored by AWS in Secrets Manager (never in Terraform state)."
  type        = string
  default     = "proctoring"
}
