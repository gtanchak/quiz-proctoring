# Queue module: the async job queue (AWS SQS) for out-of-band work — e.g. CV
# inference and evidence post-processing — so the candidate flow never blocks on
# it (CLAUDE.md §5). A dead-letter queue captures messages that repeatedly fail.
# Server-side encryption uses SQS-managed keys.

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-jobs-dlq"
  message_retention_seconds = var.dlq_message_retention_seconds
  sqs_managed_sse_enabled   = true

  tags = { Name = "${var.name_prefix}-jobs-dlq" }
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.name_prefix}-jobs"
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = { Name = "${var.name_prefix}-jobs" }
}
