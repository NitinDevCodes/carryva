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
| `MONGODB_URI` | Recommended | MongoDB connection string. Local fallback is `mongodb://127.0.0.1:27017`. |
| `MONGODB_DB` | No | Database name; defaults to `Carryva`. |
| `JWT_KEY` | Yes | At least 32 bytes of high-entropy signing key material. |
| `EXPRESS_SESSION_SECRET` | Yes | A separate, random session-cookie signing secret of at least 32 bytes. |
| `TRUST_PROXY_HOPS` | When behind a proxy | Number of trusted reverse-proxy hops, from 1 to 10. Set only to match the actual deployment network. |

Generate distinct secrets without putting them in source control, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run the command twice and use one value for each secret. In production, inject secrets through the hosting platform's secret manager rather than a committed file. TLS must terminate at the application or a trusted reverse proxy. When TLS terminates at a proxy, set `TRUST_PROXY_HOPS` accurately so secure cookies and HTTPS detection work. Do not trust arbitrary forwarded headers from the public internet.

## Production deployment

1. Provision MongoDB as a replica set or use MongoDB Atlas; enable authentication and network allow-listing, and create a least-privilege application database user.
2. Set `MONGODB_URI`, `MONGODB_DB`, `JWT_KEY`, and `EXPRESS_SESSION_SECRET` in the platform secret manager. Use distinct secrets per environment.
3. Configure a trusted HTTPS endpoint and an accurate `TRUST_PROXY_HOPS` value when applicable. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. The app sets a Content Security Policy, anti-framing, MIME-sniffing, referrer, and permissions headers.
4. Build/install with `npm ci`, then run `npm start`. The process waits for MongoDB before listening. Configure the platform to restart unhealthy processes and expose only the HTTPS endpoint.
5. Put login and registration rate limiting at the trusted ingress/load balancer. The application does not currently implement a distributed rate limiter.
6. Back up MongoDB and test restore procedures. Sessions are stored in the same configured database in the `sessions` collection with expiry; they are not stored in Express MemoryStore.

Owner accounts are created through normal registration and promoted only by an operator using `npm run owner:promote -- owner@example.com` from a trusted environment with database access. Never expose the promotion script as an HTTP endpoint.

## Images and operational limits

Product uploads accept JPEG, PNG, and WebP, up to six files, 5 MB each, and 20 MB total. The server checks image signatures and dimensions. Product and order images are stored as MongoDB binary fields and product pages currently embed them as data URIs. This preserves existing records and keeps image rendering self-contained, but increases HTML size and database load. For a larger catalog, migrate the binary fields to private object storage or GridFS, generate responsive WebP/AVIF derivatives, and serve versioned URLs behind a cache/CDN; keep order snapshots or immutable image references for historical orders.

## Tests and development utilities

- `npm test` runs authentication, product, cart, order, and standalone-safety integration suites. Set `CARRYVA_TEST_MONGODB_URI` to a disposable MongoDB replica set for transaction tests; the suites drop only their process-specific test databases. The standalone-safety suite targets local MongoDB at `127.0.0.1:27017` by default and verifies safe refusal; override it with `CARRYVA_STANDALONE_TEST_MONGODB_URI` if needed.

   ```powershell
   $env:CARRYVA_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/?replicaSet=carryva-rs'
   npm test
   ```

   ```sh
   CARRYVA_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=carryva-rs' npm test
   ```
- `npm run products:import-development` idempotently imports the existing development bag images. Review the script before using it against a non-development database.
- Product administration is at `/owners/admin`; owner setup instructions are above.

The test suite requires MongoDB. Authentication and authorization are covered by integration tests; transaction behavior must be exercised against a replica set, not a standalone local server.
