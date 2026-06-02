# Monitoring module: an SNS alert topic plus baseline CloudWatch alarms for the
# database, cache, and CDN. A starting point for on-call — not exhaustive. Alarms
# publish to the topic; subscribe a real endpoint via `alarm_email` (left empty,
# no subscription is created and alarms still fire to the topic).
#
# Note: CloudFront publishes metrics only to us-east-1; the CDN alarm assumes the
# environment region is us-east-1 (the project default).

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"

  tags = { Name = "${var.name_prefix}-alerts" }
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- RDS --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.name_prefix}-db-cpu-high"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.db_cpu_threshold
  evaluation_periods  = 3
  period              = 300
  statistic           = "Average"
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  alarm_description   = "RDS CPU utilization is high."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  tags = { Name = "${var.name_prefix}-db-cpu-high" }
}

resource "aws_cloudwatch_metric_alarm" "db_free_storage" {
  alarm_name          = "${var.name_prefix}-db-free-storage-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  comparison_operator = "LessThanThreshold"
  threshold           = var.db_free_storage_bytes_threshold
  evaluation_periods  = 1
  period              = 300
  statistic           = "Average"
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  alarm_description   = "RDS free storage space is low."
  alarm_actions       = [aws_sns_topic.alerts.arn]

  tags = { Name = "${var.name_prefix}-db-free-storage-low" }
}

resource "aws_cloudwatch_metric_alarm" "db_memory" {
  alarm_name          = "${var.name_prefix}-db-freeable-memory-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  comparison_operator = "LessThanThreshold"
  threshold           = var.db_freeable_memory_bytes_threshold
  evaluation_periods  = 3
  period              = 300
  statistic           = "Average"
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  alarm_description   = "RDS freeable memory is low."
  alarm_actions       = [aws_sns_topic.alerts.arn]

  tags = { Name = "${var.name_prefix}-db-freeable-memory-low" }
}

# --- Redis ------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${var.name_prefix}-redis-cpu-high"
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.redis_cpu_threshold
  evaluation_periods  = 3
  period              = 300
  statistic           = "Average"
  # Primary node of the replication group (member ids are <group>-001, -002, …).
  dimensions        = { CacheClusterId = "${var.redis_replication_group_id}-001" }
  alarm_description = "Redis engine CPU utilization is high."
  alarm_actions     = [aws_sns_topic.alerts.arn]

  tags = { Name = "${var.name_prefix}-redis-cpu-high" }
}

# --- CDN --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "cdn_5xx" {
  alarm_name          = "${var.name_prefix}-cdn-5xx-error-rate-high"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.cdn_5xx_threshold
  evaluation_periods  = 5
  period              = 300
  statistic           = "Average"
  dimensions          = { DistributionId = var.cdn_distribution_id, Region = "Global" }
  alarm_description   = "CloudFront 5xx error rate is elevated."
  alarm_actions       = [aws_sns_topic.alerts.arn]

  tags = { Name = "${var.name_prefix}-cdn-5xx-error-rate-high" }
}
