# Temporary Session Retention

Temporary working drafts expire 24 hours after meaningful authenticated activity. The GitHub Actions expiry worker runs every five minutes on a best-effort basis and deletes expired session rows; database foreign keys delete session-owned rows. Private Storage cleanup is not implemented in this slice, so no storage-deletion claim is made here.
