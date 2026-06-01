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

  name_prefix   = local.name_prefix
  bucket_name   = var.evidence_bucket_name
  force_destroy = var.evidence_bucket_force_destroy
}

module "container" {
  source = "../container"

  name_prefix        = local.name_prefix
  log_retention_days = var.log_retention_days
}
