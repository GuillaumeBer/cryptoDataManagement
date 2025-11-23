import { Request, Response } from 'express';
import { z } from 'zod';
import FundingRateRepository from '../models/FundingRateRepository';
import { logger } from '../utils/logger';

const MAX_FUNDING_RATE_LIMIT = 10000;

const dateStringSchema = z
  .string()
  .trim()
  .min(1, { message: 'Date cannot be empty' })
  .refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date format',
  })
  .transform(value => new Date(value));

const fundingRatesQuerySchema = z
  .object({
    asset: z.string().trim().min(1, { message: 'asset cannot be empty' }).optional(),
    platform: z.string().trim().min(1, { message: 'platform cannot be empty' }).optional(),
    sampling_interval: z
      .string()
      .trim()
      .min(1, { message: 'sampling_interval cannot be empty' })
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
      }, z.number().int().min(1).max(MAX_FUNDING_RATE_LIMIT))
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

export class FundingRateController {
  /**
   * GET /api/funding-rates
   * Get funding rates with filters
   */
  static async getFundingRates(req: Request, res: Response) {
    try {
      const parseResult = fundingRatesQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        const { fieldErrors, formErrors } = parseResult.error.flatten();
        return res.status(400).json({
          success: false,
          message: 'Invalid query parameters for funding rates',
          errors: {
            ...fieldErrors,
            ...(formErrors.length ? { _errors: formErrors } : {}),
          },
        });
      }

      const { asset, startDate, endDate, platform, sampling_interval, limit, offset } = parseResult.data;

      logger.info('[API] Funding rates request', {
        asset,
        startDate,
        endDate,
        platform,
        sampling_interval,
        limit,
        offset,
      });

      const query: any = {
        limit,
        offset,
      };

      if (asset) query.asset = asset;
      if (platform) query.platform = platform;
      if (sampling_interval) query.sampling_interval = sampling_interval;
      if (startDate) query.startDate = startDate;
      if (endDate) query.endDate = endDate;

      logger.debug('[API] Querying funding rates with', query);
      const fundingRates = await FundingRateRepository.find(query);
      logger.info('[API] Funding rates query completed', {
        asset,
        platform: query.platform || 'all',
        sampling_interval: query.sampling_interval || 'all',
        results: fundingRates.length,
      });

      res.json({
        success: true,
        data: fundingRates,
        count: fundingRates.length,
        query: {
          asset: query.asset || 'all',
          platform: query.platform || 'all',
          sampling_interval: query.sampling_interval || 'all',
          startDate: query.startDate,
          endDate: query.endDate,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      logger.error('Funding rates endpoint error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch funding rates',
        error: `${error}`,
      });
    }
  }
}
