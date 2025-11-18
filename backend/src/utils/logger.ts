import winston from 'winston';

// Safely stringify meta objects that may contain circular references
const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_, val) => {
      if (val instanceof Error) {
        const plainError: Record<string, unknown> = {
          name: val.name,
          message: val.message,
          stack: val.stack,
        };
        const errorWithProps = val as Error & Record<string, unknown>;
        Object.getOwnPropertyNames(errorWithProps).forEach((key) => {
          // Include any custom properties the error might have
          plainError[key] = errorWithProps[key];
        });
        return plainError;
      }

      if (typeof val === 'object' && val !== null) {
        const objectVal = val as Record<string, unknown>;
        if (seen.has(objectVal)) {
          return '[Circular]';
        }
        seen.add(objectVal);
      }

      return val;
    }
  );
};

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(meta).length > 0) {
            msg += ` ${safeStringify(meta)}`;
          }
          return msg;
        })
      ),
    }),
  ],
});

// Create log file in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

export default logger;
