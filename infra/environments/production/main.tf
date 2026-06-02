# Production environment. Multi-AZ database with failover-capable Redis, NAT per
# AZ (no cross-AZ egress SPOF), long backup retention, deletion protection, and
# a final DB snapshot on destroy.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

module "platform" {
  source = "../../modules/platform"

  project              = var.project
  environment          = "production"
  evidence_bucket_name = "${var.project}-production-evidence-${data.aws_caller_identity.current.account_id}"
  assets_bucket_name   = "${var.project}-production-assets-${data.aws_caller_identity.current.account_id}"

  # Networking — NAT per AZ for resilience.
  vpc_cidr          = "10.30.0.0/16"
  az_count          = 2
  nat_gateway_count = 2

  # Database — Multi-AZ, durable, protected.
  db_instance_class          = "db.r6g.large"
  db_allocated_storage       = 100
  db_max_allocated_storage   = 1000
  db_multi_az                = true
  db_backup_retention_period = 30
  db_deletion_protection     = true
  db_skip_final_snapshot     = false

  # Cache — two nodes with automatic failover.
  redis_node_type          = "cache.m6g.large"
  redis_num_cache_clusters = 2
  redis_multi_az           = true

  # Evidence — durable, kept for human review; prune old versions after 90 days.
  # Set evidence_cors_allowed_origins to the real app origin once the domain is
  # provisioned (browser signed-URL uploads need it).
  evidence_bucket_force_destroy              = false
  evidence_retention_days                    = 0
  evidence_noncurrent_version_retention_days = 90
  evidence_cors_allowed_origins              = []

  # CDN / static assets — broad edge coverage for the candidate-facing app.
  assets_bucket_force_destroy = false
  cdn_price_class             = "PriceClass_All"

  # Misc — wire alarm_email to the on-call address via tfvars/ops.
  log_retention_days = 90
  alarm_email        = ""
}
