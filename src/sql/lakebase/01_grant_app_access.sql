-- ============================================================================
-- Grant the app's service principal access to the pre-existing Lakebase
-- tables. Run ONCE, after the app's first `databricks apps deploy`, as
-- whichever identity owns the Lakebase project (typically whoever ran
-- `databricks psql ... -f 00_schema.sql` — already has full access, no
-- extra role needed).
--
-- Why this step exists: the 6 tables in `public` already exist (created in
-- initial setup by the project owner, then seeded with historical/live
-- data). The
-- app's SP gets CAN_CONNECT_AND_CREATE on the Lakebase resource automatically
-- on deploy (see resources/app.burns_piping_poc.yml), but per the
-- databricks-lakebase / AppKit docs, CAN_CONNECT_AND_CREATE only lets the SP
-- create NEW schemas it doesn't already own — it does NOT grant access to
-- schemas/tables that already exist and are owned by someone else (us). This
-- script is the documented fix: explicit GRANTs on the existing objects,
-- exactly the "Grant app SP access to synced tables" pattern from the
-- databricks-lakebase skill, extended to full CRUD (not just SELECT) since
-- this app writes.
--
-- Get the SP client ID:
--   databricks apps get burns-piping-poc --profile <your-profile> -o json \
--     | jq -r '.service_principal_client_id'
--
-- Run:
--   databricks psql --project burns-piping-poc --profile <your-profile> -- \
--     -v sp_client_id='<SP_CLIENT_ID>' -f src/sql/lakebase/01_grant_app_access.sql
-- ============================================================================

GRANT USAGE ON SCHEMA public TO :"sp_client_id";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"sp_client_id";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"sp_client_id";

-- Verify:
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
-- WHERE grantee = '<SP_CLIENT_ID>' ORDER BY table_name, privilege_type;
