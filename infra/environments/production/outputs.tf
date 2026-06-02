output "vpc_id" {
  value = module.platform.vpc_id
}

output "private_subnet_ids" {
  value = module.platform.private_subnet_ids
}

output "app_security_group_id" {
  value = module.platform.app_security_group_id
}

output "ecs_cluster_name" {
  value = module.platform.ecs_cluster_name
}

output "ecs_execution_role_arn" {
  value = module.platform.ecs_execution_role_arn
}

output "ecs_task_role_arn" {
  value = module.platform.ecs_task_role_arn
}

output "database_endpoint" {
  value = module.platform.database_endpoint
}

output "database_master_secret_arn" {
  description = "Secrets Manager ARN for the DB master credentials."
  value       = module.platform.database_master_secret_arn
}

output "redis_primary_endpoint" {
  value = module.platform.redis_primary_endpoint
}

output "evidence_bucket" {
  value = module.platform.evidence_bucket
}

output "assets_bucket" {
  value = module.platform.assets_bucket
}

output "cdn_domain_name" {
  value = module.platform.cdn_domain_name
}

output "jobs_queue_url" {
  value = module.platform.jobs_queue_url
}

output "alerts_topic_arn" {
  value = module.platform.alerts_topic_arn
}
