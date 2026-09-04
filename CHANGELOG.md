# Changelog

## v1.0.1

Stable snapshot release.

### Fixed
- Maven build failed from module dirs (`ruoyi-admin`) due to reactor scope — build from backend root now
- `copy-frontend-dist` phase in `ruoyi-vue-supabase/ruoyi-admin/pom.xml` moved to `generate-resources` so the Vue UI (`rco-ui/`) is actually packaged inside `ruoyi-admin.jar`
- Local Supabase missing `service_role` grants (hosted applies these automatically) — now captured in `supabase/sql/10_grants.sql`
- Redis dual-instance test failed on missing `.env.server` — preflight checks added with clear fail-fast messages

### Added
- `scripts/setup-supabase-local.sh` — one-command local Supabase: start, apply schema + grants + seed, generate `.env.server`
- `supabase/sql/10_grants.sql`, `supabase/sql/20_seed_local.sql` (local admin seed)
- Preflight checks in `scripts/test-redis-dual-instance.mjs` (env file, Redis TCP, Supabase health, placeholder creds)
- GitHub Actions `release-gate` workflow: full Maven build for both backends + smoke check that UI assets are bundled in jars, runs on `v*` tags

## v1.0.0

Initial snapshot: frontend assets bundled in `ruoyi-admin`, localhost defaults removed, RuoYi classic Supabase backend snapshot.
