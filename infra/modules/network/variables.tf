variable "name_prefix" {
  description = "Prefix for resource names, e.g. \"proctoring-dev\"."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets across."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 4
    error_message = "az_count must be between 2 and 4."
  }
}

variable "nat_gateway_count" {
  description = <<-EOT
    Number of NAT gateways. Use 1 in non-production (cheaper, single AZ egress)
    and one per AZ in production (no cross-AZ SPOF). Must not exceed az_count.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= var.az_count
    error_message = "nat_gateway_count must be between 1 and az_count."
  }
}
