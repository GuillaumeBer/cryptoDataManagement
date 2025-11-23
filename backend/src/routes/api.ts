import { Router } from 'express';
import { SyncController } from '../controllers/SyncController';
import { SystemController } from '../controllers/SystemController';
import { AssetController } from '../controllers/AssetController';
import { FundingRateController } from '../controllers/FundingRateController';
import { OHLCVController } from '../controllers/OHLCVController';
import { DerivativesController } from '../controllers/DerivativesController';

const router = Router();

/**
 * Sync Routes
 */
router.get('/fetch/stream', SyncController.streamInitialFetch);
router.get('/fetch/incremental/stream', SyncController.streamIncrementalFetch);
router.post('/fetch', SyncController.manualFetch);
router.post('/fetch/incremental', SyncController.manualIncrementalFetch);
router.post('/resample/hyperliquid-8h', SyncController.resampleHyperliquid8h);

/**
 * System Routes
 */
router.get('/status', SystemController.getStatus);
router.get('/logs', SystemController.getLogs);
router.get('/health', SystemController.getHealth);

/**
 * Asset Routes
 */
router.get('/assets', AssetController.getAssets);
router.get('/unified-assets', AssetController.getUnifiedAssets);
router.get('/unified-assets/multi-platform', AssetController.getMultiPlatformAssets);
router.get('/unified-assets/:id', AssetController.getUnifiedAssetById);
router.post('/unified-assets/generate-mappings', AssetController.generateMappings);
router.post('/unified-assets/manual-mapping', AssetController.createManualMapping);
router.get('/analytics/:asset', AssetController.getAssetAnalytics);

/**
 * Funding Rate Routes
 */
router.get('/funding-rates', FundingRateController.getFundingRates);

/**
 * OHLCV Routes
 */
router.get('/ohlcv', OHLCVController.getOHLCV);

/**
 * Derivatives Routes
 */
router.get('/open-interest', DerivativesController.getOpenInterest);
router.get('/long-short-ratios', DerivativesController.getLongShortRatios);
router.get('/liquidations', DerivativesController.getLiquidations);

export default router;
