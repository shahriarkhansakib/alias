# M.I.R.A - Social Publishing & Analytics Frontend

A modern React-based marketing agency dashboard for social media content publishing and performance analytics, powered by Zernio API and PostgreSQL backend persistence.

## Features
- **Dashboard**: Executive overview of total posts, reach, impressions, engagement rates, and recent activity.
- **Create / Publish Post**: Multi-platform post creator supporting text captions, image attachments, and scheduling options.
- **Posts Repository**: Searchable and filterable table of all internal posts with identity mapping status.
- **Post Details & Analytics**: Comprehensive metric breakdown (likes, comments, shares, clicks, reach, impressions) and daily timeline graphs.
- **Analytics Hub**: Cross-platform aggregation with date and platform filters powered by Recharts.
- **Social Accounts Status**: Real-time verification of Zernio API authentication and connected target accounts.

## Tech Stack
- **Framework**: React 18 & Vite
- **Language**: JavaScript (ES Modules)
- **Styling**: Tailwind CSS & Glassmorphic UI Design
- **Routing**: React Router DOM v6
- **Charts**: Recharts
- **Icons**: Lucide React
- **HTTP Client**: Axios

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
The frontend will start on `http://localhost:5173` and proxy API calls to the Backend running on `http://localhost:3000`.

### 3. Build for Production
```bash
npm run build
```
The build artifacts will be output to `dist/`.
