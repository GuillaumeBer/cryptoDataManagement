# Crypto Data Management System

A full-stack application for fetching, storing, and visualizing historical funding rate data from perpetual futures platforms, starting with Hyperliquid.

## Overview

This application solves the problem of limited historical data availability on crypto perpetual platforms. Hyperliquid only provides the last 480 hours (20 days) of funding rate data through their API. This system:

- Fetches funding rates incrementally to preserve historical data
- Stores data persistently in PostgreSQL
- Provides a modern React dashboard for visualization and analytics
- Runs automated hourly updates to maintain continuous history

## Features

- **Automated Data Collection**: Hourly scheduled jobs fetch new funding rates
- **Historical Persistence**: Never lose data beyond the API's 480-hour window
- **Multi-Asset Support**: Track all perpetual contracts on Hyperliquid
- **Interactive Dashboard**: Visualize trends, compare assets, and analyze patterns
- **Analytics**: Average rates, volatility, extremes, and more
- **Manual Controls**: Trigger data fetches on-demand

## Tech Stack

### Backend
- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 14+
- **Scheduler**: node-cron
- **API Client**: axios
- **Validation**: Zod

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Data Fetching**: TanStack Query (React Query)
- **Routing**: React Router

## Project Structure

```
cryptoDataManagement/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   └── hyperliquid/      # Hyperliquid API client
│   │   ├── services/             # Business logic
│   │   ├── models/               # Data models
│   │   ├── database/             # DB connection & migrations
│   │   ├── routes/               # Express routes
│   │   └── utils/                # Helper functions
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/           # React components
│   │   ├── services/             # API client
│   │   ├── hooks/                # Custom React hooks
│   │   ├── utils/                # Helper functions
│   │   ├── types/                # TypeScript types
│   │   └── pages/                # Page components
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── .env.example
├── data/                         # Local data storage (gitignored)
├── docs/                         # Additional documentation
└── .claude/
    └── project-description.md    # Detailed project spec
```

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18.0.0 or higher
- **npm** or **yarn** package manager
- **PostgreSQL** 14 or higher
- **Git**

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd cryptoDataManagement
```

### 2. Backend Setup

#### Install Dependencies
```bash
cd backend
npm install
```

#### Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and configure:
- Database connection string
- Hyperliquid API settings
- Server port (default: 3000)

#### Setup Database

Create a PostgreSQL database:
```bash
createdb crypto_data
```

Run migrations:
```bash
npm run db:migrate
```

#### Start Backend Server
```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start
```

The backend API will be available at `http://localhost:3000`

### 3. Frontend Setup

#### Install Dependencies
```bash
cd ../frontend
npm install
```

#### Configure Environment
```bash
cp .env.example .env
```

The default configuration should work if your backend runs on port 3000.

#### Start Frontend
```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

## Usage

### Initial Data Fetch

1. Navigate to `http://localhost:5173`
2. Click the "Fetch Initial Data" button
3. Wait for the system to retrieve the last 480 hours of funding rates
4. Data will be stored in the database for all available assets

### Automated Updates

The backend automatically runs an hourly job (configurable via `FETCH_INTERVAL_CRON`) to:
1. Fetch the latest funding rates for all assets
2. Store only new data points (avoid duplicates)
3. Maintain continuous historical records

### Viewing Data

- **Dashboard**: See overview of all assets
- **Asset Detail**: Click on any asset to view detailed charts
- **Date Range**: Select custom date ranges for analysis
- **Analytics**: View statistics like average rate, volatility, extremes

## Database Schema

### Assets Table
Stores information about each perpetual contract:
```sql
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(50) UNIQUE NOT NULL,
  platform VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Funding Rates Table
Stores hourly funding rate data:
```sql
CREATE TABLE funding_rates (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id),
  timestamp TIMESTAMP NOT NULL,
  funding_rate DECIMAL(20, 10) NOT NULL,
  premium DECIMAL(20, 10),
  platform VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(asset_id, timestamp, platform)
);
```

### Fetch Logs Table
Tracks data fetch operations:
```sql
CREATE TABLE fetch_logs (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(50) NOT NULL,
  fetch_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  records_fetched INTEGER,
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
```

## API Endpoints

### Data Management
- `POST /api/fetch` - Manually trigger data fetch
- `GET /api/assets` - List all available assets
- `GET /api/funding-rates` - Get funding rates with filters
  - Query: `asset`, `startDate`, `endDate`, `platform`
- `GET /api/status` - System status and last fetch time

### Analytics
- `GET /api/analytics/:asset` - Get statistics for specific asset
- `GET /api/compare` - Compare multiple assets
  - Query: `assets[]`, `startDate`, `endDate`

## Development

### Backend Development

```bash
cd backend

# Run in development mode with hot reload
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Testing
npm test
npm run test:watch
```

### Frontend Development

```bash
cd frontend

# Run development server
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Build for production
npm run build
npm run preview
```

## Configuration

### Backend Environment Variables

```env
PORT=3000                          # Server port
NODE_ENV=development               # Environment
DATABASE_URL=postgresql://...      # PostgreSQL connection
HYPERLIQUID_API_URL=https://...    # Hyperliquid API endpoint
FETCH_INTERVAL_CRON=0 * * * *     # Cron schedule (hourly)
LOG_LEVEL=info                     # Logging level
```

### Frontend Environment Variables

```env
VITE_API_URL=http://localhost:3000/api  # Backend API URL
VITE_ENV=development                     # Environment
```

## Hyperliquid API

### Key Endpoints Used

1. **Meta Information** (List all assets)
   ```
   POST https://api.hyperliquid.xyz/info
   Body: {"type": "meta"}
   ```

2. **Funding History** (Get funding rates)
   ```
   POST https://api.hyperliquid.xyz/info
   Body: {"type": "fundingHistory", "coin": "BTC"}
   ```

### Rate Limiting
The implementation includes:
- Exponential backoff on failures
- Request throttling to respect API limits
- Graceful error handling

## Troubleshooting

### Backend Issues

**Database connection errors:**
- Verify PostgreSQL is running: `pg_isready`
- Check DATABASE_URL in `.env`
- Ensure database exists: `psql -l`

**API fetch failures:**
- Check Hyperliquid API status
- Verify network connectivity
- Review logs for error messages

### Frontend Issues

**Cannot connect to backend:**
- Ensure backend is running on correct port
- Check VITE_API_URL in `.env`
- Verify CORS settings in backend

**Build errors:**
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (requires 18+)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/your-feature`
5. Submit a pull request

## Roadmap

- [x] Initial project setup
- [ ] Hyperliquid API integration
- [ ] Database models and migrations
- [ ] Scheduled data fetching
- [ ] Basic REST API
- [ ] React dashboard
- [ ] Chart visualizations
- [ ] Analytics features
- [ ] Additional platforms (Binance, Bybit, etc.)
- [ ] Advanced analytics (correlations, arbitrage)
- [ ] Alert system
- [ ] Mobile app

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Open an issue on GitHub
- Check the documentation in `.claude/project-description.md`
- Review API documentation at [Hyperliquid Docs](https://hyperliquid.gitbook.io/)

## Acknowledgments

- [Hyperliquid](https://hyperliquid.xyz/) for providing the API
- Built with Claude Code

---

**Version**: 1.0.0
**Last Updated**: 2025-11-14
