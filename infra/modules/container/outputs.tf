output "cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "execution_role_arn" {
  description = "IAM role ARN for the ECS task execution role (image pull + logs)."
  value       = aws_iam_role.execution.arn
}

output "task_role_arn" {
  description = "IAM role ARN for the application task role."
  value       = aws_iam_role.task.arn
}

output "task_role_name" {
  description = "Name of the application task role (for attaching service policies)."
  value       = aws_iam_role.task.name
}

output "log_group_name" {
  description = "CloudWatch log group for ECS task logs."
  value       = aws_cloudwatch_log_group.ecs.name
}
