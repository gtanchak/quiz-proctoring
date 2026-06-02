output "vpc_id" {
  description = "VPC id."
  value       = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet ids."
  value       = module.network.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet ids."
  value       = module.network.public_subnet_ids
}

output "app_security_group_id" {
  description = "Security group for application/ECS tasks."
  value       = module.network.app_security_group_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.container.cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = module.container.cluster_arn
}

output "ecs_execution_role_arn" {
  description = "ECS task execution role ARN."
  value       = module.container.execution_role_arn
}

output "ecs_task_role_arn" {
  description = "ECS application task role ARN."
  value       = module.container.task_role_arn
}

output "ecs_log_group_name" {
  description = "CloudWatch log group for ECS tasks."
  value       = module.container.log_group_name
}

output "database_endpoint" {
  description = "PostgreSQL endpoint (host:port)."
  value       = module.database.endpoint
}

output "database_name" {
  description = "Initial database name."
  value       = module.database.database_name
}

output "database_master_secret_arn" {
  description = "Secrets Manager ARN for the AWS-managed DB master credentials."
  value       = module.database.master_user_secret_arn
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint."
  value       = module.cache.primary_endpoint
}

output "evidence_bucket" {
  description = "Evidence S3 bucket name."
  value       = module.storage.bucket_id
}

output "assets_bucket" {
  description = "Static-assets (SPA) S3 bucket name."
  value       = module.cdn.assets_bucket
}

output "cdn_domain_name" {
  description = "CloudFront domain serving the static assets."
  value       = module.cdn.distribution_domain_name
}

output "cdn_distribution_id" {
  description = "CloudFront distribution id (for cache invalidations)."
  value       = module.cdn.distribution_id
}

output "jobs_queue_url" {
  description = "URL of the async jobs SQS queue."
  value       = module.queue.queue_url
}

output "jobs_queue_arn" {
  description = "ARN of the async jobs SQS queue."
  value       = module.queue.queue_arn
}

output "alerts_topic_arn" {
  description = "SNS topic that CloudWatch alarms publish to."
  value       = module.monitoring.alerts_topic_arn
}
