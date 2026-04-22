/**
 * Cloudflare Workers environment bindings for Tefnut.
 *
 * Add to wrangler.jsonc:
 *
 *   "d1_databases": [{
 *     "binding": "DB",
 *     "database_name": "tefnut-iso-compliance",
 *     "database_id": "<your-d1-id>",
 *     "migrations_dir": "db/migrations"
 *   }],
 *   "r2_buckets": [{
 *     "binding": "EVIDENCE_BUCKET",
 *     "bucket_name": "tefnut-audit-evidence"
 *   }]
 *
 * Then run:
 *   npx wrangler d1 create tefnut-iso-compliance
 *   npx wrangler d1 migrations apply tefnut-iso-compliance
 */

interface CloudflareEnv {
  /** D1 database — ISO compliance audit store */
  DB: D1Database;
  /** R2 bucket — uploaded file evidence */
  EVIDENCE_BUCKET: R2Bucket;
}
