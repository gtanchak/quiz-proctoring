output "endpoint" {
  description = "DB connection endpoint (host:port)."
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "DB hostname."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "DB port."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Initial database name."
  value       = aws_db_instance.this.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the AWS-managed master credentials."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "instance_id" {
  description = "RDS instance identifier."
  value       = aws_db_instance.this.id
}
