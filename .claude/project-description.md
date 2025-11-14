# Crypto Data Management System

## Project Overview

A full-stack application designed to fetch, store, and visualize historical funding rate data from perpetual (PERPS) trading platforms, starting with Hyperliquid.

## Purpose

Cryptocurrency perpetual futures platforms provide funding rate data that is crucial for trading analysis. However, most platforms only retain a limited historical window (e.g., Hyperliquid provides only the last 480 hours). This application solves the problem by:

1. **Incrementally fetching** funding rate data before it becomes unavailable
2. **Persisting** historical data for long-term analysis
3. **Visualizing** trends and patterns across different assets
4. **Enabling analytics** for informed trading decisions

## Core Requirements

### Data Characteristics

- **Platform**: Hyperliquid (initial implementation)
- **Data Type**: Funding rates
- **Granularity**: Hourly
- **API Limitation**: Only last 480 hours (20 days) available
- **Assets**: All available perpetual contracts on the platform

### System Architecture

#### Backend
- **Responsibility**: Data fetching and persistence
- **Key Features**:
  - Periodic data retrieval system (scheduled jobs)
  - Incremental updates to avoid data loss
  - API integration with Hyperliquid
  - Data validation and error handling
  - Storage management (database or file-based)

#### Frontend
- **Technology**: Modern React-based application
- **Key Features**:
  - Manual trigger for data retrieval
  - Data visualization dashboard
  - Per-asset analytics
  - Basic statistical analysis
  - Historical trend charts

### Data Requirements

#### Essential Fields
- **Timestamp**: Hour of the funding rate
- **Asset**: Perpetual contract symbol (e.g., BTC-PERP, ETH-PERP)
- **Funding Rate**: The funding rate value (typically in percentage)
- **Platform**: Source platform (Hyperliquid)
- **Fetch Time**: When the data was retrieved

#### Storage Strategy
Options to consider:
1. **Relational Database** (PostgreSQL, MySQL)
   - Pros: ACID compliance, complex queries, relationships
   - Cons: Setup overhead, scaling considerations

2. **Time-Series Database** (InfluxDB, TimescaleDB)
   - Pros: Optimized for time-series data, efficient queries
   - Cons: Specialized setup, learning curve

3. **NoSQL Database** (MongoDB)
   - Pros: Flexible schema, easy to start
   - Cons: Less efficient for time-series queries

4. **File-Based** (JSON/CSV with indexing)
   - Pros: Simple, no database setup
   - Cons: Slower queries, manual management

## Technical Architecture

### Backend Components

```
backend/
├── api/
│   └── hyperliquid/
│       ├── client.ts/js        # Hyperliquid API client
│       └── fundingRates.ts/js  # Funding rate fetching logic
├── services/
│   ├── scheduler.ts/js         # Periodic job scheduler
│   ├── dataFetcher.ts/js       # Orchestrates data fetching
│   └── dataStore.ts/js         # Storage abstraction layer
├── models/
│   └── FundingRate.ts/js       # Data model
├── database/
│   ├── migrations/             # DB schema migrations
│   └── connection.ts/js        # DB connection setup
└── server.ts/js                # Express/Fastify server
```

### Frontend Components

```
frontend/
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx       # Main dashboard
│   │   ├── AssetSelector.tsx   # Asset selection UI
│   │   ├── FundingRateChart.tsx # Time-series chart
│   │   ├── Analytics.tsx       # Statistical analysis
│   │   └── DataFetcher.tsx     # Manual fetch trigger
│   ├── services/
│   │   └── api.ts              # Backend API client
│   ├── hooks/
│   │   ├── useFundingRates.ts  # Data fetching hook
│   │   └── useAssets.ts        # Asset list hook
│   └── utils/
│       ├── calculations.ts     # Analytics calculations
│       └── formatters.ts       # Data formatting
```

## Key Features

### Phase 1: Core Functionality
1. **Data Fetching**
   - Connect to Hyperliquid API
   - Fetch all available assets
   - Retrieve funding rate history (last 480 hours)
   - Store in database/file system

2. **Incremental Updates**
   - Scheduled job (every hour)
   - Fetch only new data points
   - Avoid duplicates
   - Handle API failures gracefully

3. **Basic Frontend**
   - Manual fetch trigger
   - Simple data table view
   - Asset selection

### Phase 2: Visualization & Analytics
1. **Charts**
   - Time-series line charts
   - Per-asset funding rate trends
   - Multi-asset comparison
   - Date range selection

2. **Analytics**
   - Average funding rate per asset
   - Funding rate volatility
   - Extremes (min/max values)
   - Positive vs negative funding periods

3. **Enhanced UI**
   - Responsive design
   - Real-time updates
   - Export functionality (CSV/JSON)

### Phase 3: Advanced Features (Future)
1. **Additional Platforms**
   - Binance Futures
   - Bybit
   - dYdX
   - GMX

2. **Advanced Analytics**
   - Correlation analysis between assets
   - Funding rate arbitrage opportunities
   - Predictive indicators
   - Alert system for unusual rates

3. **API Endpoints**
   - RESTful API for external access
   - Webhooks for data updates
   - Historical data export

## Technical Stack (Proposed)

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express or Fastify
- **Scheduler**: node-cron or Bull (Redis-based)
- **Database**: PostgreSQL with pg library or TimescaleDB
- **API Client**: axios or node-fetch
- **Validation**: Zod or Joi

### Frontend
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **UI Library**: shadcn/ui or Material-UI
- **Charts**: Recharts or Chart.js
- **State Management**: React Query (TanStack Query)
- **Styling**: Tailwind CSS

### DevOps
- **Containerization**: Docker & Docker Compose
- **Environment**: dotenv for configuration
- **Logging**: Winston or Pino
- **Testing**: Jest (backend), Vitest (frontend)

## Data Flow

### Initial Load
1. User triggers initial data fetch (or scheduled job runs)
2. Backend queries Hyperliquid API for all assets
3. For each asset, fetch last 480 hours of funding rates
4. Validate and store in database
5. Frontend receives confirmation and can display data

### Incremental Update
1. Scheduled job runs every hour
2. Backend fetches latest funding rates for all assets
3. Compare with existing data (check latest timestamp)
4. Store only new data points
5. Frontend can poll or use WebSocket for updates

### Data Retrieval
1. User selects asset(s) and date range
2. Frontend requests data from backend API
3. Backend queries database with filters
4. Data returned and cached in frontend
5. Charts and analytics updated

## API Endpoints (Backend)

### Data Management
- `POST /api/fetch` - Manually trigger data fetch
- `GET /api/assets` - List all available assets
- `GET /api/funding-rates` - Get funding rates (with filters)
  - Query params: `asset`, `startDate`, `endDate`, `platform`
- `GET /api/status` - Get system status and last fetch time

### Analytics
- `GET /api/analytics/:asset` - Get analytics for specific asset
  - Returns: avg, min, max, volatility, etc.
- `GET /api/compare` - Compare multiple assets
  - Query params: `assets[]`, `startDate`, `endDate`

## Hyperliquid API Integration

### Key Endpoints
- **Meta Info**: `/info` (POST with `{"type": "meta"}`)
  - Returns: List of all available assets
- **Funding History**: `/info` (POST with `{"type": "fundingHistory", "coin": "BTC"}`)
  - Returns: Last 480 hours of funding rates
  - Fields: `time` (timestamp), `fundingRate`, `premium`

### Rate Limiting
- Monitor API rate limits
- Implement exponential backoff
- Batch requests where possible

## Storage Schema (Relational DB)

### Tables

#### assets
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

#### funding_rates
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

CREATE INDEX idx_funding_rates_asset_time ON funding_rates(asset_id, timestamp);
CREATE INDEX idx_funding_rates_timestamp ON funding_rates(timestamp);
```

#### fetch_logs
```sql
CREATE TABLE fetch_logs (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(50) NOT NULL,
  fetch_type VARCHAR(50) NOT NULL, -- 'initial', 'incremental'
  status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'partial'
  records_fetched INTEGER,
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
```

## Error Handling

### Backend
- API timeouts: Retry with exponential backoff (3 attempts)
- Network errors: Log and schedule retry
- Data validation: Skip invalid records, log errors
- Database errors: Transaction rollback, alert admin

### Frontend
- API failures: Display user-friendly error messages
- Loading states: Show spinners/skeletons
- Empty states: Guide user to fetch data
- Stale data: Indicate last update time

## Configuration

### Environment Variables
```env
# API
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
API_TIMEOUT=30000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/crypto_data
DATABASE_POOL_SIZE=10

# Scheduler
FETCH_INTERVAL_CRON=0 * * * * # Every hour at minute 0

# Server
PORT=3000
NODE_ENV=development

# Frontend (if separate)
VITE_API_URL=http://localhost:3000/api
```

## Development Roadmap

### Week 1-2: Backend Foundation
- [ ] Setup project structure
- [ ] Database schema and migrations
- [ ] Hyperliquid API client
- [ ] Initial data fetch implementation
- [ ] Basic error handling and logging

### Week 3-4: Incremental Updates & API
- [ ] Scheduler implementation
- [ ] Incremental update logic
- [ ] REST API endpoints
- [ ] API documentation
- [ ] Unit tests for core logic

### Week 5-6: Frontend Foundation
- [ ] React project setup
- [ ] API client and hooks
- [ ] Asset selector component
- [ ] Data table view
- [ ] Manual fetch trigger

### Week 7-8: Visualization & Analytics
- [ ] Chart components (time-series)
- [ ] Analytics calculations
- [ ] Dashboard layout
- [ ] Date range selector
- [ ] Multi-asset comparison

### Week 9-10: Polish & Deploy
- [ ] Error handling UI
- [ ] Loading states
- [ ] Responsive design
- [ ] Docker setup
- [ ] Deployment documentation
- [ ] User guide

## Success Metrics

1. **Data Completeness**: No gaps in funding rate history
2. **Reliability**: 99%+ uptime for scheduled fetches
3. **Performance**: Data fetch completes in <30 seconds
4. **UI Responsiveness**: Charts load in <2 seconds
5. **User Experience**: Intuitive navigation, clear visualizations

## Future Considerations

1. **Scalability**: Handle multiple platforms and thousands of assets
2. **Real-time Updates**: WebSocket integration for live data
3. **Mobile App**: Native or React Native application
4. **API Access**: Public API for third-party integrations
5. **Machine Learning**: Predictive models for funding rates
6. **Alerts**: Notification system for significant rate changes

## Getting Started

### Prerequisites
- Node.js 18+ and npm/yarn
- PostgreSQL 14+ (or chosen database)
- Git

### Initial Setup
```bash
# Clone repository
git clone <repository-url>

# Install backend dependencies
cd backend
npm install

# Setup database
npm run db:migrate

# Start backend
npm run dev

# In another terminal, install frontend dependencies
cd frontend
npm install

# Start frontend
npm run dev
```

### First Run
1. Access frontend at http://localhost:5173
2. Click "Fetch Initial Data" button
3. Wait for data to populate (may take 1-2 minutes)
4. Explore assets and view funding rate charts

## Resources

### Hyperliquid Documentation
- API Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
- Funding Rates: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding-rates

### Development Tools
- TypeScript: https://www.typescriptlang.org/
- React: https://react.dev/
- Recharts: https://recharts.org/
- node-cron: https://www.npmjs.com/package/node-cron

## License

MIT License (or specify your preferred license)

## Contributors

- Initial Development: [Your Name/Team]
- Maintained by: [Organization]

---

**Last Updated**: 2025-11-14
**Version**: 1.0.0
