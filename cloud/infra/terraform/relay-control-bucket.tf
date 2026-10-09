# Runtime switch files: cells/<cellId>.json read by each cell, directors.json read by the
# directors, written only by the one-cell flag workflow. The cell image derives the name from
# the metadata server's project id, so it must stay "<project_id>-relay-control".
#
# Apply only with the targeted command in the PR that added this file; a root plan rolls the
# fleet. Nothing here touches a template, MIG or service.
resource "google_storage_bucket" "relay_control" {
  project  = var.project_id
  name     = "${var.project_id}-relay-control"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # Every write is a new generation, so the object history is the audit trail.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 365
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    service     = "relay"
  }
}

# Cells share one runtime account, so IAM cannot scope a cell to its own object; the image
# reads only cells/<its cellId>.json, and read access grants no control.
resource "google_storage_bucket_iam_member" "relay_control_cell_reader" {
  bucket = google_storage_bucket.relay_control.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.relay_runtime.member
}

resource "google_storage_bucket_iam_member" "relay_control_director_reader" {
  bucket = google_storage_bucket.relay_control.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.relay_director_runtime.member
}

# The flag workflow's identity: the only writer.
resource "google_storage_bucket_iam_member" "relay_control_workflow_writer" {
  count = local.relay_create_github_deploy_identity ? 1 : 0

  bucket = google_storage_bucket.relay_control.name
  role   = "roles/storage.objectAdmin"
  member = local.relay_github_deploy_service_account_member
}
