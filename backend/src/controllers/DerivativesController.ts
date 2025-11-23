import { Request, Response } from 'express';
import { z } from 'zod';
import OpenInterestRepository from '../models/OpenInterestRepository';
import LongShortRatioRepository from '../models/LongShortRatioRepository';
import { liquidationRepository } from '../models/LiquidationRepository';
import { logger } from '../utils/logger';
import type { OpenInterestWithAsset, LongShortRatioQuery } from '../models/types';

const MAX_OPEN_INTEREST_LIMIT = 10000;
const MAX_LONG_SHORT_RATIO_LIMIT = 10000;
const MAX_LIQUIDATION_LIMIT = 10000;

const dateStringSchema = z
  .string()
  .trim()
  .min(1, { message: 'Date cannot be empty' })
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date format',
  })
  .transform(value => new Date(value));

const openInterestQuerySchema = z
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
      }, z.number().int().min(1).max(MAX_OPEN_INTEREST_LIMIT))
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

const longShortRatioQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    timeframe: z
      .string()
      .trim()
      .min(1, { message: 'timeframe cannot be empty' })
      .optional(),
    type: z.string().trim().min(1, { message: 'type cannot be empty' }).optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    limit: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(1).max(MAX_LONG_SHORT_RATIO_LIMIT))
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

const liquidationQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    limit: z
      .preprocess(value => {
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? value : parsed;
        }
        return value;
      }, z.number().int().min(1).max(MAX_LIQUIDATION_LIMIT))
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

const serializeOpenInterestRecord = (record: OpenInterestWithAsset) => ({
  ...record,
  open_interest: Number(record.open_interest),
  open_interest_value: parseDecimal(record.open_interest_value),
});

export class DerivativesController {
  /**
   * GET /api/open-interest
   * Get Open Interest data with filters
   */
  static async getOpenInterest(req: Request, res: Response) {
    try {
      const parseResult = openInterestQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        const { fieldErrors, formErrors } = parseResult.error.flatten();
        return res.status(400).json({
          success: false,
          message: 'Invalid query parameters for Open Interest data',
          errors: {
            ...fieldErrors,
            ...(formErrors.length ? { _errors: formErrors } : {}),
          },
        });
      }

      const { asset, startDate, endDate, platform, timeframe, limit, offset } = parseResult.data;

      logger.info('[API] Open Interest request', {
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

      const openInterestData = await OpenInterestRepository.find(query);
      logger.info(`[API] Found ${openInterestData.length} Open Interest records for query:`, query);
      const serializedData = openInterestData.map(serializeOpenInterestRecord);

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
      logger.error('Open Interest endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch Open Interest data',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/long-short-ratios
   * Get Long/Short Ratio data with filters
   */
  static async getLongShortRatios(req: Request, res: Response) {
    try {
      const parseResult = longShortRatioQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        const { fieldErrors, formErrors } = parseResult.error.flatten();
        return res.status(400).json({
          success: false,
          message: 'Invalid query parameters for Long/Short Ratio data',
          errors: {
            ...fieldErrors,
            ...(formErrors.length ? { _errors: formErrors } : {}),
          },
        });
      }

      const { asset, platform, timeframe, type, startDate, endDate, limit, offset } = parseResult.data;

      logger.info('[API] Long/Short ratios request', {
        asset,
        platform,
        timeframe,
        type,
        startDate,
        endDate,
        limit,
        offset,
      });

      const query: LongShortRatioQuery = { limit, offset };
      if (asset) query.asset = asset;
      if (platform) query.platform = platform;
      if (timeframe) query.timeframe = timeframe;
      if (type) query.type = type;
      if (startDate) query.startDate = startDate;
      if (endDate) query.endDate = endDate;

      const ratios = await LongShortRatioRepository.find(query);
      logger.info('[API] Long/Short ratios query completed', {
        asset: query.asset || 'all',
        platform: query.platform || 'all',
        timeframe: query.timeframe || 'all',
        type: query.type || 'all',
        results: ratios.length,
      });

      res.json({
        success: true,
        data: ratios,
        count: ratios.length,
        query: {
          asset: query.asset || 'all',
          platform: query.platform || 'all',
          timeframe: query.timeframe || 'all',
          type: query.type || 'all',
          startDate: query.startDate,
          endDate: query.endDate,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      logger.error('Long/Short ratios endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch Long/Short Ratio data',
        error: `${error}`,
      });
    }
  }

  /**
   * GET /api/liquidations
   * Get liquidation records with filters
   */
  static async getLiquidations(req: Request, res: Response) {
    try {
      const parseResult = liquidationQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        const { fieldErrors, formErrors } = parseResult.error.flatten();
        return res.status(400).json({
          success: false,
          message: 'Invalid query parameters for liquidation data',
          errors: {
            ...fieldErrors,
            ...(formErrors.length ? { _errors: formErrors } : {}),
          },
        });
      }

      const { asset, platform, startDate, endDate, limit, offset } = parseResult.data;

      const query: any = { limit, offset };
      if (asset) query.assetSymbol = asset;
      if (platform) query.platform = platform;
      if (startDate) query.startDate = startDate;
      if (endDate) query.endDate = endDate;

      const records = await liquidationRepository.find(query);
      const serialized = records.map((record) => ({
        ...record,
        price: Number(record.price),
        quantity: Number(record.quantity),
        volume_usd: Number(record.volume_usd),
      }));

      res.json({
        success: true,
        data: serialized,
        count: serialized.length,
        query: {
          asset: asset || 'all',
          platform: platform || 'all',
          startDate: query.startDate,
          endDate: query.endDate,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      logger.error('Liquidations endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch liquidation data',
        error: `${error}`,
      });
    }
  }
}
