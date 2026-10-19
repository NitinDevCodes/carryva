# Carryva

Carryva is a bags-only ecommerce application built with Express, EJS, Mongoose, and MongoDB. It includes public product browsing, owner-managed catalog and fulfilment, customer authentication, persistent carts, and cash-on-delivery orders.

## Requirements

- Node.js 20 or newer
- MongoDB 6 or newer; use a replica set or MongoDB Atlas for checkout and transactional order cancellation

## Local setup

1. Install packages: `npm ci`
2. Copy `.env.example` to `.env` and replace both secret placeholders with unique random values. Keep `.env` out of version control.
3. Start MongoDB as a single-node replica set. For a local development server, add this to its `mongod.cfg` (preserving the existing `storage.dbPath` and other settings), then restart that MongoDB service:

   ```yaml
   replication:
     replSetName: carryva-rs
   ```

   Initialize it once with `mongosh "mongodb://127.0.0.1:27017/Carryva" --eval "rs.initiate()"`. If the replica set is already initialized, do not run `rs.initiate()` again. Use `MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=carryva-rs` in `.env`.
4. Start Carryva with `npm start`, then open <http://localhost:3000>. Use `npm run dev` for Node's watch mode.

The app checks the MongoDB topology on startup. A standalone server can serve the catalog, but checkout and cancellation are refused with an explicit message because these operations require transactions. Carryva never falls back to multi-write order placement.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `NODE_ENV` | Production | Set to `production` for deployment. |
| `MONGODB_URI` | **Yes in production** | MongoDB connection string. Development only may use the local fallback `mongodb://127.0.0.1:27017`. Production startup rejects a missing or malformed URI. |
| `MONGODB_DB` | No | Database name; defaults to `Carryva`. |
| `JWT_KEY` | Yes | At least 32 bytes of high-entropy signing key material. |
| `EXPRESS_SESSION_SECRET` | Yes | A separate, random session-cookie signing secret of at least 32 bytes. |
| `TRUST_PROXY_HOPS` | When behind a proxy | Number of trusted reverse-proxy hops, from 1 to 10. Set only to match the actual deployment network. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | Login and registration rate-limit window in milliseconds; defaults to `900000` (15 minutes). |
| `AUTH_RATE_LIMIT_MAX` | No | Login and registration attempts per client IP in the window; defaults to `10`. |

Generate distinct secrets without putting them in source control, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run the command twice and use one value for each secret. In production, inject secrets through the hosting platform's secret manager rather than a committed file. TLS must terminate at the application or a trusted reverse proxy. When TLS terminates at a proxy, set `TRUST_PROXY_HOPS` accurately so secure cookies and HTTPS detection work. Do not trust arbitrary forwarded headers from the public internet.

## Production deployment

1. Provision MongoDB Atlas or another replica set; enable authentication and network allow-listing, and create a least-privilege application database user. Checkout and cancellation require transactions.
2. Set `NODE_ENV=production`, `MONGODB_URI`, `MONGODB_DB`, `JWT_KEY`, and `EXPRESS_SESSION_SECRET` through the host's secret/configuration manager. Use distinct, random secrets of at least 32 bytes. Production does not load `.env`; startup validates required values and reports configuration names only, never secret values. Do not deploy `.env` or commit real credentials.
3. Configure an HTTPS endpoint. If TLS terminates at a reverse proxy, set `TRUST_PROXY_HOPS` to the actual trusted hop count. Production auth and session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`; security headers are enabled.
4. Install with `npm ci` and start with `npm start`. The process waits for MongoDB before listening. Point the platform liveness check to `GET /health/live` and the readiness check to `GET /health/ready`. Liveness returns `200` while the HTTP process is running. Readiness returns `200` only when MongoDB is connected and supports transactions; otherwise it returns `503`. Both return only a small status value and no connection or topology details.
5. Login and registration use an application-level per-IP fixed-window limiter. Defaults are 10 combined attempts per 15 minutes, configurable with `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS`; rejected requests return `429` and `Retry-After`. The limiter uses Express's resolved client IP, so configure proxy trust accurately. Counts are held in process memory and are per instance; for multiple app instances, also configure a shared rate limit at the trusted ingress/load balancer.
6. Configure platform restarts for unhealthy processes and expose only HTTPS. Sessions use the configured MongoDB database's `sessions` collection with expiry; they are not stored in Express MemoryStore.
7. Seed only the intended demo database with `npm run products:import-development`. Register an owner account through the normal form, then promote it once from a trusted environment with `npm run owner:promote -- owner@example.com`. Customer accounts can register through the public form. Never expose the promotion script as an HTTP endpoint.
8. Check `/health/ready`, run the customer and owner demo journey, and verify the product catalog before sharing the public URL. Keep the local development database separate; do not point seed/import commands at it unintentionally.

## Images and operational limits

Product uploads accept JPEG, PNG, and WebP, up to six files and 5 MB each. The aggregate limit is based on base64 data-URI size: no more than 12 MiB after encoding, which leaves a conservative 4 MiB margin under MongoDB's 16 MiB BSON document limit for other fields and document overhead. The equivalent source image total is about 9 MiB, depending on content types. Oversized submissions receive a clear `413` response. The server checks image signatures and dimensions. Product and order images are stored as MongoDB binary fields and product pages currently embed them as data URIs. This preserves existing records and keeps image rendering self-contained, but increases HTML size and database load. For a larger catalog, migrate the binary fields to private object storage or GridFS, generate responsive WebP/AVIF derivatives, and serve versioned URLs behind a cache/CDN; keep order snapshots or immutable image references for historical orders.

## Tests and development utilities

- `npm test` runs authentication, product, cart, order, deployment-readiness, and standalone-safety suites. Set `CARRYVA_TEST_MONGODB_URI` to a disposable MongoDB replica set for transaction tests; the suites drop only their process-specific test databases. The standalone-safety suite targets local MongoDB at `127.0.0.1:27017` by default and verifies safe refusal; override it with `CARRYVA_STANDALONE_TEST_MONGODB_URI` if needed.

   ```powershell
   $env:CARRYVA_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/?replicaSet=carryva-rs'
   npm test
   ```

   ```sh
   CARRYVA_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=carryva-rs' npm test
   ```
- `npm run products:import-development` idempotently imports the existing development bag images. Review the script before using it against a non-development database.
- Product administration is at `/owners/admin`; owner setup instructions are above.

The test suite requires MongoDB. Authentication, authorization, health/readiness, upload-size bounds, and rate limiting are covered by integration or focused tests; transaction behavior must be exercised against a replica set, not a standalone local server. Rate-limit counters are process-local, so multi-instance deployments should enable an ingress-level shared limit as well.
