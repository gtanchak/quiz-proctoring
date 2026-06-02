output "assets_bucket" {
  description = "Static-assets S3 bucket name (upload the SPA build here)."
  value       = aws_s3_bucket.assets.id
}

output "distribution_id" {
  description = "CloudFront distribution id (used for cache invalidations and alarms)."
  value       = aws_cloudfront_distribution.assets.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.assets.arn
}

output "distribution_domain_name" {
  description = "CloudFront domain name serving the static assets."
  value       = aws_cloudfront_distribution.assets.domain_name
}
