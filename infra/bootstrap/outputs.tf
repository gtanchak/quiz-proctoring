output "state_bucket" {
  description = "Name of the S3 bucket holding Terraform remote state. Use as the `bucket` in each environment's backend.tf."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "Name of the DynamoDB lock table. Use as the `dynamodb_table` in each environment's backend.tf."
  value       = aws_dynamodb_table.lock.name
}

output "region" {
  description = "Region the backend lives in. Use as the backend `region`."
  value       = var.region
}
