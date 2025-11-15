const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

const normalizeOrigins = (value: string | undefined): string[] => {
  if (!value) {
    return DEFAULT_ORIGINS;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

export const allowedOrigins = normalizeOrigins(process.env.ALLOWED_ORIGINS);

export const isOriginAllowed = (origin?: string | null): boolean => {
  if (!origin) {
    return false;
  }

  return allowedOrigins.includes(origin);
};

export default allowedOrigins;
