-- Fix Binance funding rate sampling intervals
-- Binance uses 8-hour funding intervals, but data was incorrectly stored as 1h

-- Update all Binance funding rates from 1h to 8h
UPDATE funding_rates
SET sampling_interval = '8h'
WHERE platform = 'binance' AND sampling_interval = '1h';

-- Verify the update
SELECT
    platform,
    sampling_interval,
    COUNT(*) as record_count
FROM funding_rates
WHERE platform = 'binance'
GROUP BY platform, sampling_interval
ORDER BY platform, sampling_interval;
