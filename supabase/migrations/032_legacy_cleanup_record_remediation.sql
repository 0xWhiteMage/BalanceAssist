-- Records left behind when their session was deleted still contain the old
-- session-prefixed name. The service-role cleanup worker deletes the object;
-- this migration removes only the linkable recovery metadata.
DELETE FROM public.private_attachment_cleanup
WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
