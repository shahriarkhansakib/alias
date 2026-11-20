# Object Storage Architecture (Phase 7.2)

## Overview

Alias Img-Gen decouples all creative pipeline services from local filesystems using a provider-agnostic `StorageProvider` interface.

```
Application (Services / APIs)
           ↓
   StorageProvider (ABC)
   ├── LocalStorageProvider (Development / Offline Tests)
   └── S3CompatibleStorageProvider (Production: AWS S3 & Cloudflare R2)
```

No database table stores binary pixel data; PostgreSQL stores only immutable references, logical object keys, dimensions, MIME types, and SHA-256 provenance hashes.

---

## 1. Storage Providers

### A. LocalStorageProvider (Development & Testing)
- **Use Case**: Frictionless offline development, rapid prototyping, and CI unit tests.
- **Security & Path Traversal Guards**:
  - Enforces strict path containment within `LOCAL_STORAGE_PATH` (`./storage`).
  - Rejects POSIX path traversal (`../../`), Windows path traversal (`..\..\`), mixed separators, root paths (`/`), drive-letter paths (`C:\`), and percent-encoded sequences (`%2e%2e`).
  - Prohibits null bytes (`\x00`).
- **Integrity**: Calculates SHA-256 on write; rejects conflicting writes to existing immutable keys.

### B. S3CompatibleStorageProvider (Production)
- **Use Case**: Production asset storage targeting **AWS S3** or **Cloudflare R2** (zero egress fee object storage).
- **Features**:
  - Non-blocking I/O via `asyncio.to_thread` wrapping standard `boto3` client.
  - Standard `s3v4` request signing (mandatory for Cloudflare R2 and modern S3).
  - Private bucket support by default: object keys are proxied securely via `/api/v1/storage/{key}` without exposing cloud credentials or requiring public bucket policies.
  - Optional `S3_PUBLIC_BASE_URL` (e.g. Cloudflare R2 public domain or AWS CloudFront CDN) when direct CDN serving is preferred.
  - Automatic `Metadata={"sha256": ...}` tagging on upload.
  - Content integrity checking prevents silent corrupting overwrites of immutable assets.

---

## 2. Configuration & Environment Variables

| Variable | Provider | Default | Description |
|---|---|---|---|
| `STORAGE_PROVIDER` / `STORAGE_TYPE` | All | `local` | `local`, `s3`, or `r2`. |
| `LOCAL_STORAGE_PATH` | Local | `./storage` | Directory path for local filesystem storage. |
| `STORAGE_PUBLIC_URL_PREFIX` | Local / Private S3 | `/api/v1/storage` | Route prefix for serving stored creative assets. |
| `S3_BUCKET` | S3 / R2 | None | Target object bucket name (required if `s3` or `r2`). |
| `S3_ACCESS_KEY_ID` | S3 / R2 | None | Access Key ID / R2 Token ID (required if `s3` or `r2`). |
| `S3_SECRET_ACCESS_KEY` | S3 / R2 | None | Secret Access Key / R2 Secret (required if `s3` or `r2`). |
| `S3_REGION` | S3 / R2 | `us-east-1` | AWS region (use `auto` for Cloudflare R2). |
| `S3_ENDPOINT_URL` | S3 / R2 | None | Custom S3 endpoint (required for Cloudflare R2; optional for AWS S3). |
| `S3_PUBLIC_BASE_URL` | S3 / R2 | None | Optional CDN base URL (e.g., `https://cdn.example.com` or `https://pub-<id>.r2.dev`). |

### Production Startup Validation
If `STORAGE_PROVIDER="s3"` (or `"r2"`):
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are mandatory. Application startup fails with `ValueError` if any credential is missing.

---

## 3. Production Cloud Setup Guides

### AWS S3 Setup
1. Create an S3 Bucket:
   - Name: `alias-creatives-prod`
   - Region: `us-east-1` (or desired region)
   - **Block all public access**: Enabled (Private bucket recommended)
2. IAM User & Policy:
   - Create an IAM service user with programmatic access:
   ```json
   {
       "Version": "2012-10-17",
       "Statement": [
           {
               "Effect": "Allow",
               "Action": [
                   "s3:PutObject",
                   "s3:GetObject",
                   "s3:HeadObject",
                   "s3:DeleteObject"
               ],
               "Resource": "arn:aws:s3:::alias-creatives-prod/*"
           }
       ]
   }
   ```
3. Set Environment:
   ```bash
   STORAGE_PROVIDER="s3"
   S3_BUCKET="alias-creatives-prod"
   S3_REGION="us-east-1"
   S3_ACCESS_KEY_ID="AKIA..."
   S3_SECRET_ACCESS_KEY="wJalr..."
   ```

### Cloudflare R2 Setup (Recommended for Zero Egress Fees)
1. In Cloudflare Dashboard, go to **R2** > **Create bucket** (`alias-creatives-prod`).
2. Create an **R2 API Token** with `Object Read & Write` permissions on the bucket.
3. Configure Environment:
   ```bash
   STORAGE_PROVIDER="s3"
   S3_ENDPOINT_URL="https://<cloudflare_account_id>.r2.cloudflarestorage.com"
   S3_REGION="auto"
   S3_BUCKET="alias-creatives-prod"
   S3_ACCESS_KEY_ID="<r2_access_key_id>"
   S3_SECRET_ACCESS_KEY="<r2_secret_access_key>"
   # Optional: If public R2 bucket / custom domain is attached:
   # S3_PUBLIC_BASE_URL="https://creatives.yourdomain.com"
   ```

---

## 4. Deterministic Object Key Design

All object keys are generated through validated logical namespaces without user-controlled filesystem paths:

| Asset Type | Storage Key Structure | Example |
|---|---|---|
| **Backgrounds** | `backgrounds/{job_id}/{platform}_attempt_{attempt}.png` | `backgrounds/550e8400.../instagram_attempt_1.png` |
| **Product Cutouts** | `cutouts/{job_id}/product_cutout.png` | `cutouts/550e8400.../product_cutout.png` |
| **Composites** | `composites/{job_id}/{platform}_attempt_{attempt}.png` | `composites/550e8400.../instagram_attempt_1.png` |
| **Final Advertisements** | `final_ads/{job_id}/{platform}/final_ad_attempt_{attempt}.png` | `final_ads/550e8400.../instagram/final_ad_attempt_1.png` |

Key validation rules ([storage_keys.py](file:///c:/Users/annin/Desktop/Alias_Img-Gen/backend/app/providers/storage_keys.py)):
- Prohibits backslashes (`\`) — all object storage delimiters must be forward slashes (`/`).
- Prohibits path traversal (`..`).
- Prohibits leading slashes, trailing slashes, or empty path segments.
- Prohibits drive letters, control characters, and null bytes (`\x00`).

---

## 5. Migration from Local Storage to S3

If migrating existing local assets from `./storage` to an S3/R2 bucket:
1. Sync files using AWS CLI or R2 CLI:
   ```bash
   aws s3 sync ./storage s3://alias-creatives-prod/ --endpoint-url https://<account_id>.r2.cloudflarestorage.com
   ```
2. Existing PostgreSQL records contain relative storage keys (e.g. `final_ads/.../final_ad_attempt_1.png`), which match the exact S3 object keys. No database migration is required.
3. Switch `STORAGE_PROVIDER="s3"` in `.env`.
