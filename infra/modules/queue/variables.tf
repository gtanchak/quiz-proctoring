variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "How long a received message is hidden from other consumers. Should exceed the worker's processing time."
  type        = number
  default     = 30
}

variable "message_retention_seconds" {
  description = "How long an unconsumed message is kept. Default 4 days."
  type        = number
  default     = 345600
}

variable "dlq_message_retention_seconds" {
  description = "Retention for dead-lettered messages — longer, to allow investigation. Default 14 days."
  type        = number
  default     = 1209600
}

variable "max_receive_count" {
  description = "Deliveries attempted before a message is moved to the dead-letter queue."
  type        = number
  default     = 5
}
