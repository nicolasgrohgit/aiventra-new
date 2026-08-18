import mongoose from 'mongoose';

let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    // Read at call time, not module load time: every consumer of this module calls
    // dotenv.config() in its own entry file, and if that happens to run after this
    // module was first imported (easy to get wrong, since import ordering doesn't
    // visually signal execution order), a module-top-level read here would silently
    // capture the no-auth localhost fallback instead of the real .env value.
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/odysai';
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }
  
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
