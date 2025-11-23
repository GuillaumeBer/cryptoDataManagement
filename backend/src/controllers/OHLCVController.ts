import { Request, Response } from 'express';
import { z } from 'zod';
import OHLCVRepository from '../models/OHLCVRepository';
import { logger } from '../utils/logger';
import type { OHLCVWithAsset } from '../models/types';

const MAX_OHLCV_LIMIT = 10000;

const dateStringSchema = z
  .string()
  .trim()
  .min(1, { message: 'Date cannot be empty' })
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date format',
  })
  .transform(value => new Date(value));

const ohlcvQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    timeframe: z
      .string()
      .trim()
      .min(1, { message: 'timeframe cannot be empty' })
      .optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    limit: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(1).max(MAX_OHLCV_LIMIT))
      .optional()
      .default(1000),
    offset: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(0))
      .optional()
      .default(0),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startDate must be before or equal to endDate',
        path: ['startDate'],
      });
    }
  });

const parseDecimal = (value: string | null) => (value === null ? null : Number(value));

const serializeOHLCVRecord = (record: OHLCVWithAsset) => ({
  ...record,
  open: Number(record.open),
  high: Number(record.high),
  low: Number(record.low),
  close: Number(record.close),
  volume: parseDecimal(record.volume),
  quote_volume: parseDecimal(record.quote_volume),
});

export class OHLCVController {
  /**
   * GET /api/ohlcv
   * Get OHLCV data with filters
   */
  static async getOHLCV(req: Request, res: Response) {
    try {
      const parseResult = ohlcvQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        const { fieldErrors, formErrors } = parseResult.error.flatten();
        return res.status(400).json({
          success: false,
          message: 'Invalid query parameters for OHLCV data',
          errors: {
            ...fieldErrors,
            ...(formErrors.length ? { _errors: formErrors } : {}),
          },
        });
      }

      const { asset, startDate, endDate, platform, timeframe, limit, offset } = parseResult.data;

      logger.info('[API] OHLCV request', {
        asset,
        startDate,
        endDate,
        platform,
        timeframe,
        limit,
        offset,
      });

      const query: any = {
        limit,
        offset,
      };

      if (asset) query.asset = asset;
      if (platform) query.platform = platform;
      if (timeframe) query.timeframe = timeframe;
      if (startDate) query.startDate = startDate;
      if (endDate) query.endDate = endDate;

      logger.debug('[API] Querying OHLCV with', query);
      const ohlcvData = await OHLCVRepository.getAggregatedOHLCV(query);
      logger.info(`[API] Found ${ohlcvData.length} OHLCV records for query:`, query);
      const serializedData = ohlcvData.map(serializeOHLCVRecord);
      logger.info('[API] OHLCV query completed', {
        asset,
        platform: query.platform || 'all',
        timeframe: query.timeframe || 'all',
        results: serializedData.length,
      });

      res.json({
        success: true,
        data: serializedData,
        count: serializedData.length,
        query: {
          asset: query.asset || 'all',
          platform: query.platform || 'all',
          timeframe: query.timeframe || 'all',
          startDate: query.startDate,
          endDate: query.endDate,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      logger.error('OHLCV endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch OHLCV data',
        error: `${error}`,
      });
    }
  }
}
