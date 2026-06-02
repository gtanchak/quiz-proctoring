# Storage module: the private evidence bucket (webcam snapshots, audio, ID
# images). Encrypted, versioned, and fully blocked from public access — all
# evidence is served only via signed, time-limited URLs (CLAUDE.md §5/§6).
#
# PRO-38 adds lifecycle/retention and CORS here. Evidence is deliberately NOT
# fronted by a public CDN — it is read via signed, time-limited S3 URLs minted
# by core-api. The CloudFront CDN (`cdn` module) serves only the public SPA
# static assets, never this bucket.

resource "aws_s3_bucket" "evidence" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy

  tags = { Name = "${var.name_prefix}-evidence" }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: bound version sprawl, reclaim failed uploads, and (optionally)
# expire current objects after a retention window.
resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  # Versioning is on; expire superseded versions so overwrites/deletes don't
  # accumulate forever.
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
  }

  # Reclaim storage from interrupted multipart uploads.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Optional retention on current objects (0 = keep indefinitely).
  dynamic "rule" {
    for_each = var.retention_days > 0 ? [1] : []

    content {
      id     = "expire-current-objects"
      status = "Enabled"

      filter {}

      expiration {
        days = var.retention_days
      }
    }
  }
}

# CORS for the browser signed-URL upload path (PRO-15). Only created when origins
# are configured; the bucket stays private (uploads use time-limited signed URLs).
resource "aws_s3_bucket_cors_configuration" "evidence" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.evidence.id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
