output "vpc_id" {
  description = "VPC id."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet ids (one per AZ)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet ids (one per AZ)."
  value       = aws_subnet.private[*].id
}

output "app_security_group_id" {
  description = "Security group for application/ECS tasks."
  value       = aws_security_group.app.id
}

output "database_security_group_id" {
  description = "Security group for the database (ingress from app only)."
  value       = aws_security_group.database.id
}

output "cache_security_group_id" {
  description = "Security group for Redis (ingress from app only)."
  value       = aws_security_group.cache.id
}
