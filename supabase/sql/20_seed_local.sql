-- LOCAL DEVELOPMENT ONLY. Do not run against a hosted/production project.
-- Default local admin: admin / admin123 (bcrypt hash, cost 10).
insert into public.users (username, password_hash, role)
values ('admin', '$2b$10$pmMzk8xaiMj5W2w3356XCONjZxZtlV7tiOgUw6wflKuIFST5q4QAO', 'admin')
on conflict (username) do update set password_hash = excluded.password_hash;
