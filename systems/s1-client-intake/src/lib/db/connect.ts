import mongoose from "mongoose";

export class DatabaseConnectionError extends Error {
  statusCode: number;
  constructor(message: string, cause?: any) {
    super(message);
    this.name = "DatabaseConnectionError";
    this.statusCode = 503;
    if (cause) this.cause = cause;
  }
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose | null> | null;
  isAvailable: boolean | null;
  lastFailureTime: number | null;
  lastError: Error | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache || {
  conn: null,
  promise: null,
  isAvailable: null,
  lastFailureTime: null,
  lastError: null,
};

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

/**
 * Connects to MongoDB with robust Atlas replica set handling.
 * Automatically recovers from transient connection blips and avoids aggressive lockouts.
 */
export async function dbConnect(): Promise<typeof mongoose | null> {
  const allowMemoryFallback = process.env.ALLOW_MEMORY_FALLBACK !== "false";

  // Fast-path: already connected
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    cached.isAvailable = true;
    cached.lastFailureTime = null;
    return mongoose;
  }

  // If a connection is actively in progress, await it
  if (mongoose.connection.readyState === 2 && cached.promise) {
    try {
      const conn = await cached.promise;
      if (conn && isMongoConnected()) {
        cached.conn = conn;
        cached.isAvailable = true;
        cached.lastFailureTime = null;
        return conn;
      }
    } catch {
      cached.promise = null;
    }
  }

  // Short 3-second cooldown to avoid tight spin-loops on complete network outage
  const now = Date.now();
  if (cached.lastFailureTime && now - cached.lastFailureTime < 3000) {
    if (!allowMemoryFallback) {
      throw new DatabaseConnectionError(
        "[Database] MongoDB connection is currently reconnecting. Please retry in a moment."
      );
    }
    return null;
  }

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_marketing_agency";
    const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: isTest ? 200 : 10000, // 200ms for sub-second test fallbacks, 10s for Atlas
      connectTimeoutMS: isTest ? 200 : 10000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose
      .connect(uri, opts)
      .then((m) => {
        cached.conn = m;
        cached.isAvailable = true;
        cached.lastFailureTime = null;
        return m;
      })
      .catch((err) => {
        console.error("[Database] MongoDB connection failed:", err.message || err);
        cached.conn = null;
        cached.promise = null;
        cached.isAvailable = false;
        cached.lastFailureTime = Date.now();
        cached.lastError = err instanceof Error ? err : new Error(String(err));
        if (!allowMemoryFallback) {
          throw new DatabaseConnectionError(`[Database] MongoDB connection failed: ${err.message || err}`, err);
        }
        console.warn("[Database] Operating in Resilient Local Demo Storage Mode.");
        return null;
      });
  }

  try {
    cached.conn = await cached.promise;
    cached.isAvailable = true;
    cached.lastFailureTime = null;
    cached.lastError = null;
    return cached.conn;
  } catch (err: any) {
    cached.promise = null;
    cached.conn = null;
    cached.isAvailable = false;
    cached.lastFailureTime = Date.now();
    cached.lastError = err instanceof Error ? err : new Error(String(err));
    if (!allowMemoryFallback) {
      if (err instanceof DatabaseConnectionError) {
        throw err;
      }
      throw new DatabaseConnectionError(`[Database] MongoDB connection failed: ${err.message || err}`, err);
    }
    return null;
  }
}

export function getLastDatabaseError(): Error | null {
  return cached.lastError;
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export default dbConnect;
