# Dev environment. Smallest, cheapest sizing; single NAT; non-durable
# (force-destroyable bucket, minimal backups) so it can be torn down freely.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

# Account id namespaces the (globally-unique) evidence bucket name so no manual
# input is needed and dev/staging/prod never collide.
data "aws_caller_identity" "current" {}

module "platform" {
  source = "../../modules/platform"

  project              = var.project
  environment          = "dev"
  evidence_bucket_name = "${var.project}-dev-evidence-${data.aws_caller_identity.current.account_id}"
  assets_bucket_name   = "${var.project}-dev-assets-${data.aws_caller_identity.current.account_id}"

  # Networking
  vpc_cidr          = "10.10.0.0/16"
  az_count          = 2
  nat_gateway_count = 1

  # Database — smallest, minimal backups, freely destroyable.
  db_instance_class          = "db.t3.micro"
  db_allocated_storage       = 20
  db_multi_az                = false
  db_backup_retention_period = 1
  db_deletion_protection     = false
  db_skip_final_snapshot     = true

  # Cache — single small node.
  redis_node_type          = "cache.t3.micro"
  redis_num_cache_clusters = 1
  redis_multi_az           = false

  # Evidence — throwaway env: short retention, freely destroyable, allow local
  # app origins to upload via signed URLs.
  evidence_bucket_force_destroy              = true
  evidence_retention_days                    = 7
  evidence_noncurrent_version_retention_days = 7
  evidence_cors_allowed_origins              = ["http://localhost:5173", "http://localhost:5174"]

  # CDN / static assets
  assets_bucket_force_destroy = true
  cdn_price_class             = "PriceClass_100"

  # Misc
  log_retention_days = 7
  alarm_email        = ""
}
