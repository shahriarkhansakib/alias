# AI Marketing Social Publishing & Analytics Agent Backend

A robust TypeScript/Node.js backend service providing normalized social media publishing, platform routing, and a dashboard-ready analytics layer integrated with Zernio API.

---

## 🏗️ System Architecture

```
                                 ┌─────────────────────────────┐
                                 │      Dashboard / API        │
                                 └──────────────┬──────────────┘
                                                │
                      ┌─────────────────────────┴─────────────────────────┐
                      ▼                                                   ▼
         ┌─────────────────────────┐                         ┌─────────────────────────┐
         │    Publishing Layer     │                         │     Analytics Layer     │
         └────────────┬────────────┘                         └────────────┬────────────┘
                      │                                                   │
         ┌────────────┴────────────┐                         ┌────────────┴────────────┐
         │    Platform Router      │                         │  Analytics Cache / Repo │
         └────────────┬────────────┘                         └────────────┬────────────┘
                      │                                                   │
                      └─────────────────────────┬─────────────────────────┘
                                                ▼
                                   ┌─────────────────────────┐
                                   │      Zernio Client      │
                                   └────────────┬────────────┘
                                                ▼
                                   ┌─────────────────────────┐
                                   │    Zernio API (v1)      │
                                   └─────────────────────────┘
```

---

## 📊 Analytics Architecture & Features

The analytics subsystem provides a provider-independent interface (`SocialAnalyticsProvider`) implemented via `ZernioAnalyticsProvider`.

### Key Components

1. **`SocialAnalyticsProvider` Interface**: Abstracts analytics data fetching into normalized methods:
   - `getPostAnalytics(postId: string)`
   - `getPostTimeline(postId: string)`
   - `getOverview(filter?: AnalyticsOverviewFilter)`

2. **Upstream API Integration**:
   - `GET /v1/analytics`: Fetches overall post metrics and performance data.
   - `GET /v1/analytics/post-timeline`: Retrieves time-series performance data for individual posts.
   - `GET /v1/analytics/daily-metrics`: Fetches aggregated daily platform performance metrics.

3. **Modular Caching Layer (`AnalyticsRepositoryService`)**:
   - Implements an in-memory repository with configurable TTL (default: 5 minutes) to prevent redundant upstream API calls on frequent dashboard refreshes.
   - Designed with clean repository interfaces so it can be swapped to persistent storage (e.g., PostgreSQL, Redis, MongoDB) in the future without changing business logic.

4. **Normalized Dashboard Data Model**:
   ```json
   {
     "postId": "6ab40cc2f089802ac774c50b",
     "platform": "facebook",
     "metrics": {
       "impressions": 1500,
       "reach": 1200,
       "likes": 80,
       "comments": 12,
       "shares": 9,
       "saves": 2,
       "clicks": 23,
       "views": 0,
       "engagementRate": 10.33
     },
     "reactionBreakdown": null,
     "timeline": [
       {
         "date": "2026-09-24",
         "impressions": 1500,
         "reach": 1200,
         "likes": 80,
         "comments": 12,
         "shares": 9,
         "saves": 2,
         "clicks": 23,
         "views": 0,
         "engagementRate": 10.33
       }
     ],
     "fetchedAt": "2026-09-24T13:45:00.000Z"
   }
   ```

5. **Engagement Rate Calculation**:
   - Formula: `((likes + comments + shares + clicks) / (reach > 0 ? reach : (impressions > 0 ? impressions : 1))) * 100` rounded to 2 decimal places.

6. **Facebook Reaction Breakdown Limitation Note**:
   > ⚠️ **Upstream API Capability Note**:
   > The Zernio API returns total reaction counts under the unified `likes` metric field. Individual Facebook reaction types (`like`, `love`, `haha`, `wow`, `sad`, `angry`) are **not currently exposed by the upstream Zernio API**.
   >
   > The normalized data model includes `reactionBreakdown: ReactionBreakdown | null`. When individual reaction metrics are unsupported upstream, `reactionBreakdown` resolves to `null`. If Zernio or future providers expose per-reaction counts, the layer will automatically parse and expose them without breaking frontend contracts.

---

## 📡 API Endpoints

### 1. Publishing Endpoints
- **`POST /api/social/publish`**: Publish or schedule content across target platforms (Facebook, Instagram, LinkedIn, X, etc.).
- **`GET /api/social/posts`**: Retrieve list of tracked local posts.
- **`GET /api/social/posts/:id`**: Retrieve status of specific post by internal ID.
- **`GET /api/social/auth/verify`**: Non-publishing Zernio API key verification check.

### 2. Analytics Endpoints
- **`GET /api/social/analytics/overview`**: Aggregated performance metrics for dashboard headers/cards.
  - **Query Parameters**:
    - `platform` (optional, e.g. `facebook`)
    - `fromDate` (optional, e.g. `2026-09-01`)
    - `toDate` (optional, e.g. `2026-09-24`)
- **`GET /api/social/analytics/:postId`**: Detailed metrics, engagement rate, reaction breakdown, and timeline for a specific post.
- **`GET /api/social/analytics/:postId/timeline`**: Time-series metric points over time for charting.

---

## ⚙️ Environment Configuration

Create a `.env` file in the project root:
```env
PORT=3000
NODE_ENV=development
ZERNIO_API_KEY=sk_your_zernio_api_key_here
ZERNIO_BASE_URL=https://zernio.com/api/v1
```

> 🔒 **Security Notice**: Never commit `.env` or hard-code API keys.

---

## 🚀 Running & Testing

### Installation
```bash
npm install
```

### TypeScript Build
```bash
npm run build
```

### Unit & Integration Tests
```bash
npm test
```

### Development Server
```bash
npm run dev
```
