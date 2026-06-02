output "alerts_topic_arn" {
  description = "SNS topic that all alarms publish to."
  value       = aws_sns_topic.alerts.arn
}
