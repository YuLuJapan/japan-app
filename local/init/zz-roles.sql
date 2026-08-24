-- Passwords for the roles the Supabase services log in as.
--
-- supabase/postgres ships these roles but leaves them without a password —
-- fine for a managed project (the services are wired up out of band), not for
-- a stack we assemble ourselves.
--
-- The `zz-` prefix is load-bearing: the Postgres entrypoint runs everything in
-- /docker-entrypoint-initdb.d in sorted order, and the image's own migrate.sh
-- is what creates these roles. Sort before it and this file dies on a role
-- that does not exist yet, taking the container down with it.
--
-- Local-only credentials: this file is mounted into throwaway containers on a
-- private network and is never part of a deployed project.
alter role authenticator          with password 'postgres';
alter role supabase_auth_admin    with password 'postgres';
alter role supabase_storage_admin with password 'postgres';
