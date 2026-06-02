# Platform module: composes the per-environment baseline (network → database,
# cache, storage, container) into one unit. Each environment stack instantiates
# this once with environment-specific sizing, so all the real wiring lives here
# and the environment directories stay thin.

locals {
  name_prefix = "${var.project}-${var.environment}"
}

module "network" {
  source = "../network"

  name_prefix       = local.name_prefix
  vpc_cidr          = var.vpc_cidr
  az_count          = var.az_count
  nat_gateway_count = var.nat_gateway_count
}

module "database" {
  source = "../database"

  name_prefix             = local.name_prefix
  subnet_ids              = module.network.private_subnet_ids
  security_group_id       = module.network.database_security_group_id
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  max_allocated_storage   = var.db_max_allocated_storage
  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_period
  deletion_protection     = var.db_deletion_protection
  skip_final_snapshot     = var.db_skip_final_snapshot
}

module "cache" {
  source = "../cache"

  name_prefix        = local.name_prefix
  subnet_ids         = module.network.private_subnet_ids
  security_group_id  = module.network.cache_security_group_id
  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_cache_clusters
  multi_az           = var.redis_multi_az
}

module "storage" {
  source = "../storage"

  name_prefix                       = local.name_prefix
  bucket_name                       = var.evidence_bucket_name
  force_destroy                     = var.evidence_bucket_force_destroy
  retention_days                    = var.evidence_retention_days
  noncurrent_version_retention_days = var.evidence_noncurrent_version_retention_days
  cors_allowed_origins              = var.evidence_cors_allowed_origins
}

module "container" {
  source = "../container"

  name_prefix        = local.name_prefix
  log_retention_days = var.log_retention_days
}

# CDN for the public SPA static assets (evidence is never served here).
module "cdn" {
  source = "../cdn"

  name_prefix        = local.name_prefix
  assets_bucket_name = var.assets_bucket_name
  force_destroy      = var.assets_bucket_force_destroy
  price_class        = var.cdn_price_class
}

# Async job queue (SQS) for out-of-band work (CV inference, evidence processing).
module "queue" {
  source = "../queue"

  name_prefix = local.name_prefix
}

# Baseline alarms + alert topic for the database, cache, and CDN.
module "monitoring" {
  source = "../monitoring"

  name_prefix                = local.name_prefix
  alarm_email                = var.alarm_email
  db_instance_id             = module.database.instance_id
  redis_replication_group_id = module.cache.replication_group_id
  cdn_distribution_id        = module.cdn.distribution_id
}

# Application task-role permissions: write/read evidence and use the job queue.
# Attached here (the composition layer) because it spans storage + queue + the
# task role created in the container module.
data "aws_iam_policy_document" "task_access" {
  statement {
    sid       = "EvidenceBucketReadWrite"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${module.storage.bucket_arn}/*"]
  }

  statement {
    sid       = "EvidenceBucketList"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.bucket_arn]
  }

  statement {
    sid = "JobQueue"
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [module.queue.queue_arn, module.queue.dlq_arn]
  }
}

resource "aws_iam_role_policy" "task_access" {
  name   = "${local.name_prefix}-task-access"
  role   = module.container.task_role_name
  policy = data.aws_iam_policy_document.task_access.json
}
