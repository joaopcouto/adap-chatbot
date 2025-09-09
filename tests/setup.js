// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.MAX_SYNC_RETRIES = '3';
process.env.SYNC_RETRY_BASE_DELAY_MS = '1000';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-long';