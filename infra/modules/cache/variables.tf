variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the cache subnet group."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group id controlling access to Redis."
  type        = string
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t3.micro"
}

variable "num_cache_clusters" {
  description = "Number of nodes in the replication group. Use >= 2 with multi_az for automatic failover."
  type        = number
  default     = 1
}

variable "multi_az" {
  description = "Enable Multi-AZ with automatic failover. Requires num_cache_clusters >= 2 (enforced by ElastiCache at apply time)."
  type        = bool
  default     = false
}
