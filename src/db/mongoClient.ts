/**
 * MongoDB client singleton for the ADO credential store.
 *
 * Pattern reference: dg-api-gate/src/util/mongodb.ts
 *   - dg-api-gate uses Mongoose with MONGODB_URI env var and a connectToDatabase() bootstrap call.
 *   - We use the native mongodb driver (not Mongoose) for the following reasons:
 *     1. The MCP ADO server uses ES modules with minimal deps; Mongoose adds ~1.5MB and ODM overhead.
 *     2. The credential store requires precise async lifecycle control (connect on demand,
 *        graceful shutdown on SIGTERM/SIGINT) that the native driver exposes cleanly.
 *     3. Atomic upsert operations on credential documents benefit from direct BSON control.
 *     4. No Mongoose deprecation warnings about connection options (v5 vs v6 differences).
 *   - The MONGODB_URI env var name matches dg-api-gate convention for operational consistency.
 *   - Connection error handling is stricter than dg-api-gate: startup failure in
 *     trusted_user_header mode throws (fatal) rather than silently continuing without DB.
 */

import { MongoClient, type Db } from 'mongodb';
import type { Logger } from '../logging/logger.js';

let _client: MongoClient | null = null;
let _db: Db | null = null;

export interface MongoConnection {
  client: MongoClient;
  db: Db;
}

/**
 * Connect to MongoDB. Idempotent — returns existing connection if already established.
 * Throws if the URI is missing or the connection fails.
 */
export async function connectMongo(mongoUri: string, dbName: string, logger: Logger): Promise<MongoConnection> {
  if (_client && _db) {
    return { client: _client, db: _db };
  }

  const client = new MongoClient(mongoUri, {
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 5,
    minPoolSize: 1,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    // Lightweight connectivity check
    await db.command({ ping: 1 });
    _client = client;
    _db = db;
    logger.info({ dbName }, 'Connected to MongoDB successfully');
    return { client, db };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Do not log the URI — it may contain credentials
    logger.error({ dbName, message }, 'MongoDB connection failed');
    await client.close().catch(() => { /* ignore close errors */ });
    throw new Error(`MongoDB connection failed: ${message}`);
  }
}

/**
 * Return the existing db handle. Throws if not yet connected.
 */
export function getDb(): Db {
  if (!_db) {
    throw new Error('MongoDB not connected. Call connectMongo() first.');
  }
  return _db;
}

/**
 * Return whether a connection is established.
 */
export function isMongoConnected(): boolean {
  return _client !== null && _db !== null;
}

/**
 * Gracefully disconnect. Called on server shutdown.
 */
export async function disconnectMongo(logger: Logger): Promise<void> {
  if (_client) {
    try {
      await _client.close();
      logger.info({}, 'MongoDB disconnected');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ message }, 'MongoDB disconnect error');
    } finally {
      _client = null;
      _db = null;
    }
  }
}

/** Reset singleton — test use only. */
export function _resetMongoForTest(): void {
  _client = null;
  _db = null;
}
