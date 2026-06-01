# Storage module: the private evidence bucket (webcam snapshots, audio, ID
# images). Encrypted, versioned, and fully blocked from public access — all
# evidence is served only via signed, time-limited URLs (CLAUDE.md §5/§6).
#
# Seam for PRO-38: lifecycle/retention rules and the CloudFront distribution are
# layered on top of this bucket there, not duplicated here.

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
