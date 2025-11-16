import { BinanceAsset } from '../../api/binance/types';
import { BybitAsset } from '../../api/bybit/types';
import { HyperliquidAsset } from '../../api/hyperliquid/types';
import { OKXAsset } from '../../api/okx/types';
import { DyDxAsset } from '../../api/dydx/types';
import { AsterAsset } from '../../api/aster/types';
import { CreateAssetParams } from '../../models/types';
import { logger } from '../../utils/logger';

export const SUPPORTED_PLATFORMS = [
  'hyperliquid',
  'binance',
  'bybit',
  'okx',
  'dydx',
  'aster',
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export type PlatformAssetPayload =
  | HyperliquidAsset
  | BinanceAsset
  | BybitAsset
  | OKXAsset
  | DyDxAsset
  | AsterAsset;

export type NormalizedPlatformAsset = CreateAssetParams;

type PlatformNormalizer = (
  asset: PlatformAssetPayload
) => NormalizedPlatformAsset | null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const warnMissingField = (
  platform: SupportedPlatform,
  field: string,
  asset: PlatformAssetPayload
) => {
  logger.warn(`Skipping ${platform} asset: missing ${field}`, { asset });
};

const normalizeWithSymbol = (
  platform: SupportedPlatform,
  asset: PlatformAssetPayload,
  symbol: unknown,
  nameCandidates: unknown[]
): NormalizedPlatformAsset | null => {
  if (!isNonEmptyString(symbol)) {
    warnMissingField(platform, 'symbol', asset);
    return null;
  }

  const normalizedSymbol = symbol.trim();
  const normalizedName =
    nameCandidates
      .map((candidate) => (isNonEmptyString(candidate) ? candidate.trim() : ''))
      .find((value) => value.length > 0) || normalizedSymbol;

  return {
    platform,
    symbol: normalizedSymbol,
    name: normalizedName,
  };
};

const isHyperliquidAsset = (asset: PlatformAssetPayload): asset is HyperliquidAsset =>
  typeof (asset as HyperliquidAsset).name === 'string';

const isBinanceAsset = (asset: PlatformAssetPayload): asset is BinanceAsset =>
  typeof (asset as BinanceAsset).pair === 'string';

const isBybitAsset = (asset: PlatformAssetPayload): asset is BybitAsset =>
  typeof (asset as BybitAsset).baseCoin === 'string';

const isOKXAsset = (asset: PlatformAssetPayload): asset is OKXAsset =>
  typeof (asset as OKXAsset).instId === 'string';

const isDyDxAsset = (asset: PlatformAssetPayload): asset is DyDxAsset =>
  typeof (asset as DyDxAsset).ticker === 'string';

const isAsterAsset = (asset: PlatformAssetPayload): asset is AsterAsset =>
  typeof (asset as AsterAsset).symbol === 'string';

const hyperliquidNormalizer: PlatformNormalizer = (asset) => {
  if (!isHyperliquidAsset(asset)) {
    warnMissingField('hyperliquid', 'name', asset);
    return null;
  }

  return normalizeWithSymbol('hyperliquid', asset, asset.name, [asset.name]);
};

const binanceNormalizer: PlatformNormalizer = (asset) => {
  if (!isBinanceAsset(asset)) {
    warnMissingField('binance', 'symbol', asset);
    return null;
  }

  return normalizeWithSymbol('binance', asset, asset.symbol, [asset.baseAsset, asset.symbol]);
};

const bybitNormalizer: PlatformNormalizer = (asset) => {
  if (!isBybitAsset(asset)) {
    warnMissingField('bybit', 'symbol', asset);
    return null;
  }

  return normalizeWithSymbol('bybit', asset, asset.symbol, [asset.baseCoin, asset.quoteCoin]);
};

const okxNormalizer: PlatformNormalizer = (asset) => {
  if (!isOKXAsset(asset)) {
    warnMissingField('okx', 'instId', asset);
    return null;
  }

  return normalizeWithSymbol('okx', asset, asset.instId, [asset.baseCcy, asset.uly]);
};

const dydxNormalizer: PlatformNormalizer = (asset) => {
  if (!isDyDxAsset(asset)) {
    warnMissingField('dydx', 'ticker', asset);
    return null;
  }

  return normalizeWithSymbol('dydx', asset, asset.ticker, [asset.baseAsset, asset.quoteAsset]);
};

const asterNormalizer: PlatformNormalizer = (asset) => {
  if (!isAsterAsset(asset)) {
    warnMissingField('aster', 'symbol', asset);
    return null;
  }

  return normalizeWithSymbol('aster', asset, asset.symbol, [asset.baseAsset, asset.quoteAsset]);
};

const normalizers: Record<SupportedPlatform, PlatformNormalizer> = {
  hyperliquid: hyperliquidNormalizer,
  binance: binanceNormalizer,
  bybit: bybitNormalizer,
  okx: okxNormalizer,
  dydx: dydxNormalizer,
  aster: asterNormalizer,
};

export const normalizePlatformAsset = (
  platform: SupportedPlatform,
  asset: PlatformAssetPayload
): NormalizedPlatformAsset | null => {
  const normalizer = normalizers[platform];
  return normalizer(asset);
};

export const isSupportedPlatform = (platform: string): platform is SupportedPlatform =>
  SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform);
