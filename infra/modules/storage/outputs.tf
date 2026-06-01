output "bucket_id" {
  description = "Evidence bucket name."
  value       = aws_s3_bucket.evidence.id
}

output "bucket_arn" {
  description = "Evidence bucket ARN."
  value       = aws_s3_bucket.evidence.arn
}

output "bucket_domain_name" {
  description = "Regional domain name of the evidence bucket."
  value       = aws_s3_bucket.evidence.bucket_regional_domain_name
}
