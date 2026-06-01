# Staging environment. Production-shaped but smaller and single-AZ; a realistic
# pre-production target with proper backups and durable storage.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

module "platform" {
  source = "../../modules/platform"

  project              = var.project
  environment          = "staging"
  evidence_bucket_name = "${var.project}-staging-evidence-${data.aws_caller_identity.current.account_id}"

  # Networking
  vpc_cidr          = "10.20.0.0/16"
  az_count          = 2
  nat_gateway_count = 1

  # Database — small, real backups, kept on destroy.
  db_instance_class          = "db.t3.small"
  db_allocated_storage       = 20
  db_max_allocated_storage   = 200
  db_multi_az                = false
  db_backup_retention_period = 7
  db_deletion_protection     = false
  db_skip_final_snapshot     = false

  # Cache — single small node.
  redis_node_type          = "cache.t3.small"
  redis_num_cache_clusters = 1
  redis_multi_az           = false

  # Misc
  log_retention_days            = 30
  evidence_bucket_force_destroy = false
}
