# Database module: a managed PostgreSQL instance (AWS RDS) in private subnets.
#
# The master password is AWS-managed (`manage_master_user_password`): RDS
# generates it and stores it in Secrets Manager, so no credential is ever placed
# in source or Terraform state (CLAUDE.md §6). Applications read the secret ARN
# (exposed as an output) at deploy time.

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.name_prefix}-db-subnets" }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username
  # AWS generates and rotates the master password into Secrets Manager.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  port                   = 5432
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_period
  deletion_protection     = var.deletion_protection

  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name_prefix}-db-final"

  auto_minor_version_upgrade = true

  tags = { Name = "${var.name_prefix}-db" }
}
