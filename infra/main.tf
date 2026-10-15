# Ubuntu 22.04 EC2 instance with Docker, an Elastic IP and ports 22/80/443 open.
# Not applied in this session: run `terraform plan` and review before `apply`.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  default = "ap-south-1" # Mumbai
}

variable "instance_type" {
  default = "t3.medium" # 4 GB RAM: app + practice-lab PostgreSQL, MySQL and MongoDB
}

variable "key_name" {
  description = "Name of an existing EC2 key pair, used for SSH"
  type        = string
}

variable "ssh_cidr" {
  description = "Who may SSH in. Use your own IP, e.g. 203.0.113.5/32"
  default     = "0.0.0.0/0"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "academy" {
  name        = "dba-academy"
  description = "SSH, HTTP, HTTPS"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "academy" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.academy.id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = <<-EOT
    #!/bin/bash
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu
    apt-get install -y unzip
  EOT

  tags = { Name = "dba-academy" }
}

resource "aws_eip" "academy" {
  instance = aws_instance.academy.id
  domain   = "vpc"
}

output "server_ip" {
  description = "Create a DNS A record for your domain pointing here"
  value       = aws_eip.academy.public_ip
}

output "ssh" {
  value = "ssh -i <your-key>.pem ubuntu@${aws_eip.academy.public_ip}"
}
