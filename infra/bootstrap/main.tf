# Bootstrap stack: the shared Terraform state backend (S3 bucket + DynamoDB lock
# table). This is the one stack that uses LOCAL state, because it creates the
# very backend the other stacks depend on (a chicken-and-egg). Run it once per
# AWS account before initialising any environment. See README.md.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Component = "tf-backend"
    }
  }
}

# Remote state bucket — versioned (so state history is recoverable) and fully
# private. State can contain sensitive values, so encryption + public-access
# block are mandatory (CLAUDE.md §6).
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # State is precious — guard against accidental `terraform destroy` of the
  # backend taking every environment's state with it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State locking table. Terraform writes a single item keyed by "LockID".
resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
