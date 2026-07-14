# Deletion Processing Runbook

Authenticated deletion requests create one opaque job and return its current status. `requested`, `claimed`, `processing`, and `failed` mean deletion is not complete; only `completed` confirms the application data deletion.

GitHub Actions invokes the internal deletion worker every five minutes. Investigate an alert when the `deletion-worker` heartbeat is older than 20 minutes or a non-completed deletion job is older than 24 hours. Confirm Storage is available, manually dispatch the GitHub workflow if required, and do not delete session metadata manually: the worker must remove private objects before their metadata and before the session cascade.

The service deletes the temporary session, its owned application rows, and known private attachment objects within 24 hours. It cannot retract content already transferred to Telegram or erase provider backups immediately; those systems follow their own retention and deletion processes. Jobs retain only opaque identifiers, lifecycle state, lease data, and timestamps, never deleted draft, contact, attachment, or raw-error data.
