# CDN module: a CloudFront distribution serving the candidate/admin SPA static
# assets from a private S3 origin via Origin Access Control (OAC). These assets
# are public by nature (the app's HTML/JS/CSS), so the distribution allows public
# GETs. Evidence is NEVER served here — it stays private behind signed S3 URLs
# (see the storage module).

resource "aws_s3_bucket" "assets" {
  bucket        = var.assets_bucket_name
  force_destroy = var.force_destroy

  tags = { Name = "${var.name_prefix}-assets" }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${var.name_prefix}-assets-oac"
  description                       = "OAC for the ${var.name_prefix} static assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "assets" {
  enabled             = true
  comment             = "${var.name_prefix} static assets"
  default_root_object = "index.html"
  price_class         = var.price_class
  http_version        = "http2and3"
  is_ipv6_enabled     = true

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "assets-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    target_origin_id       = "assets-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed "CachingOptimized" policy (stable, well-known id).
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA routing: client-side routes 404 against S3, so serve index.html instead.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Default *.cloudfront.net cert; a custom domain + ACM cert is a follow-up.
    cloudfront_default_certificate = true
  }

  tags = { Name = "${var.name_prefix}-assets-cdn" }
}

# Allow only this distribution to read the assets bucket (keeps the bucket
# private; CloudFront is the single public entry point).
data "aws_iam_policy_document" "assets" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.assets.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets.json
}
