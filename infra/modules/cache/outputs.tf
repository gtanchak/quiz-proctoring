output "primary_endpoint" {
  description = "Primary endpoint hostname for writes."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint" {
  description = "Reader endpoint hostname (present when there is more than one node)."
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "port" {
  description = "Redis port."
  value       = aws_elasticache_replication_group.this.port
}
