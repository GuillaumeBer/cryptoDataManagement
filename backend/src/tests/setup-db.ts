import { initTestDb, resetTestDb, closeTestDb } from './helpers/test-db';

initTestDb();

jest.mock('../database/connection', () => {
  const helpers = require('../tests/helpers/test-db');
  helpers.initTestDb();

  return {
    getPool: () => helpers.getTestPool(),
    query: (text: string, params?: any[]) => helpers.getTestPool().query(text, params),
    getClient: () => helpers.getTestPool().connect(),
    closePool: () => helpers.closeTestDb(),
    testConnection: jest.fn().mockResolvedValue(true),
  };
});

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await closeTestDb();
});
