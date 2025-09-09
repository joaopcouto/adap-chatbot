import dotenv from 'dotenv';
import { structuredLogger } from '../helpers/logger.js';

// Load environment variables
dotenv.config();

/**
 * Configuration management system with validation and feature flags
 */
class ConfigManager {
  constructor() {
    this.config = {};
    this.featureFlags = {};
    this.validationErrors = [];
    
    this.loadConfiguration();
    this.validateConfiguration();
    
    if (this.validationErrors.length > 0) {
      structuredLogger.error('Configuration validation failed', { errors: this.validationErrors });
      throw new Error(`Configuration validation failed: ${this.validationErrors.join(', ')}`);
    }
    
    structuredLogger.info('Configuration loaded successfully', { 
      environment: this.config.nodeEnv,
      featuresEnabled: Object.keys(this.featureFlags).filter(key => this.featureFlags[key])
    });
  }

  /**
   * Load all configuration from environment variables with defaults
   */
  loadConfiguration() {
    // Core application configuration
    this.config = {
      // Environment
      nodeEnv: process.env.NODE_ENV || 'development',
      port: parseInt(process.env.PORT) || 3000,
      logLevel: process.env.LOG_LEVEL || 'INFO',
      
      // Database
      mongoUri: process.env.MONGO_URI,
      
      // Google OAuth Configuration
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      },
      
      // Twilio Configuration
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER,
        reminderTemplateSid: process.env.TWILIO_REMINDER_TEMPLATE_SID,
        installmentTemplateSid: process.env.TWILIO_INSTALLMENT_TEMPLATE_SID,
      },
      
      // OpenAI Configuration
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
      },
      
      // Cloudinary Configuration
      cloudinary: {
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      },
      
      // Google Calendar Integration Configuration
      googleCalendar: {
        defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo',
        defaultEventDurationMinutes: parseInt(process.env.DEFAULT_EVENT_DURATION_MINUTES) || 30,
        maxSyncRetries: parseInt(process.env.MAX_SYNC_RETRIES) || 3,
        syncRetryBaseDelayMs: parseInt(process.env.SYNC_RETRY_BASE_DELAY_MS) || 1000,
        syncRetryMaxDelayMs: parseInt(process.env.SYNC_RETRY_MAX_DELAY_MS) || 30000,
        syncRetryBackoffMultiplier: parseFloat(process.env.SYNC_RETRY_BACKOFF_MULTIPLIER) || 2,
        syncRetryJitterFactor: parseFloat(process.env.SYNC_RETRY_JITTER_FACTOR) || 0.1,
      },
      
      // Token Encryption
      encryption: {
        key: process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'default-key-for-development-only',
      },
      
      // Job Configuration
      jobs: {
        syncRetryCronSchedule: process.env.SYNC_RETRY_CRON_SCHEDULE || '*/5 * * * *',
        syncRetryBatchSize: parseInt(process.env.SYNC_RETRY_BATCH_SIZE) || 20,
        syncCleanupAgeThreshold: parseInt(process.env.SYNC_CLEANUP_AGE_DAYS) || 30,
        syncCleanupBatchSize: parseInt(process.env.SYNC_CLEANUP_BATCH_SIZE) || 100,
        alertingCronSchedule: process.env.ALERTING_CRON_SCHEDULE || '*/5 * * * *',
      },
      
      // Rate Limiting
      rateLimiting: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
      },
    };

    // Feature flags
    this.featureFlags = {
      googleCalendarIntegrationEnabled: this.parseBoolean(process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED, true),
      syncRetryEnabled: this.parseBoolean(process.env.SYNC_RETRY_ENABLED, true),
      backgroundSyncEnabled: this.parseBoolean(process.env.BACKGROUND_SYNC_ENABLED, true),
      alertingEnabled: this.parseBoolean(process.env.ALERTING_ENABLED, true),
      metricsCollectionEnabled: this.parseBoolean(process.env.METRICS_COLLECTION_ENABLED, true),
      enhancedLoggingEnabled: this.parseBoolean(process.env.ENHANCED_LOGGING_ENABLED, false),
      debugModeEnabled: this.parseBoolean(process.env.DEBUG_MODE_ENABLED, false),
    };
  }

  /**
   * Validate required configuration values
   */
  validateConfiguration() {
    const requiredFields = [
      { path: 'mongoUri', name: 'MONGO_URI' },
      { path: 'twilio.accountSid', name: 'TWILIO_ACCOUNT_SID' },
      { path: 'twilio.authToken', name: 'TWILIO_AUTH_TOKEN' },
      { path: 'twilio.phoneNumber', name: 'TWILIO_PHONE_NUMBER' },
      { path: 'openai.apiKey', name: 'OPENAI_API_KEY' },
    ];

    // Validate Google Calendar integration if enabled
    if (this.featureFlags.googleCalendarIntegrationEnabled) {
      requiredFields.push(
        { path: 'google.clientId', name: 'GOOGLE_CLIENT_ID' },
        { path: 'google.clientSecret', name: 'GOOGLE_CLIENT_SECRET' },
        { path: 'google.redirectUri', name: 'GOOGLE_REDIRECT_URI' },
        { path: 'encryption.key', name: 'TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY' }
      );
    }

    // Check required fields
    for (const field of requiredFields) {
      const value = this.getNestedValue(this.config, field.path);
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        this.validationErrors.push(`Missing required environment variable: ${field.name}`);
      }
    }

    // Validate numeric ranges
    this.validateNumericRange('port', 1, 65535);
    this.validateNumericRange('googleCalendar.defaultEventDurationMinutes', 1, 1440); // 1 minute to 24 hours
    this.validateNumericRange('googleCalendar.maxSyncRetries', 0, 10);
    this.validateNumericRange('googleCalendar.syncRetryBaseDelayMs', 100, 60000); // 100ms to 1 minute
    this.validateNumericRange('rateLimiting.maxRequests', 1, 1000);

    // Validate encryption key strength in production
    if (this.config.nodeEnv === 'production' || this.config.nodeEnv === 'prod') {
      if (this.config.encryption.key === 'default-key-for-development-only') {
        this.validationErrors.push('Production environment requires a secure TOKEN_ENCRYPTION_KEY');
      }
      if (this.config.encryption.key.length < 32) {
        this.validationErrors.push('TOKEN_ENCRYPTION_KEY must be at least 32 characters long in production');
      }
    }

    // Validate timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: this.config.googleCalendar.defaultTimezone });
    } catch (error) {
      this.validationErrors.push(`Invalid timezone: ${this.config.googleCalendar.defaultTimezone}`);
    }
  }

  /**
   * Validate numeric value is within range
   */
  validateNumericRange(path, min, max) {
    const value = this.getNestedValue(this.config, path);
    if (typeof value === 'number' && (value < min || value > max)) {
      this.validationErrors.push(`${path} must be between ${min} and ${max}, got ${value}`);
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Parse boolean from string with default value
   */
  parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const stringValue = String(value).toLowerCase().trim();
    return stringValue === 'true' || stringValue === '1' || stringValue === 'yes';
  }

  /**
   * Get configuration value
   */
  get(path, defaultValue = undefined) {
    const value = this.getNestedValue(this.config, path);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Check if feature flag is enabled
   */
  isFeatureEnabled(featureName) {
    return this.featureFlags[featureName] === true;
  }

  /**
   * Get all feature flags
   */
  getFeatureFlags() {
    return { ...this.featureFlags };
  }

  /**
   * Get all configuration (for debugging/monitoring)
   */
  getAllConfig() {
    // Return sanitized config without sensitive data
    const sanitized = JSON.parse(JSON.stringify(this.config));
    
    // Remove sensitive fields
    if (sanitized.twilio) {
      sanitized.twilio.authToken = '***';
    }
    if (sanitized.openai) {
      sanitized.openai.apiKey = '***';
    }
    if (sanitized.google) {
      sanitized.google.clientSecret = '***';
    }
    if (sanitized.cloudinary) {
      sanitized.cloudinary.apiSecret = '***';
    }
    if (sanitized.encryption) {
      sanitized.encryption.key = '***';
    }
    
    return {
      config: sanitized,
      featureFlags: this.featureFlags,
      environment: this.config.nodeEnv,
      validationErrors: this.validationErrors
    };
  }

  /**
   * Runtime configuration update (for feature flags only)
   */
  updateFeatureFlag(featureName, enabled) {
    if (!(featureName in this.featureFlags)) {
      throw new Error(`Unknown feature flag: ${featureName}`);
    }
    
    const oldValue = this.featureFlags[featureName];
    this.featureFlags[featureName] = Boolean(enabled);
    
    structuredLogger.info('Feature flag updated', {
      feature: featureName,
      oldValue,
      newValue: this.featureFlags[featureName],
      timestamp: new Date().toISOString()
    });
    
    return this.featureFlags[featureName];
  }

  /**
   * Get configuration documentation
   */
  getConfigurationDocs() {
    return {
      environmentVariables: {
        required: [
          'MONGO_URI - MongoDB connection string',
          'TWILIO_ACCOUNT_SID - Twilio account SID',
          'TWILIO_AUTH_TOKEN - Twilio authentication token',
          'TWILIO_PHONE_NUMBER - Twilio phone number for WhatsApp',
          'OPENAI_API_KEY - OpenAI API key for AI services'
        ],
        googleCalendarIntegration: [
          'GOOGLE_CLIENT_ID - Google OAuth client ID',
          'GOOGLE_CLIENT_SECRET - Google OAuth client secret',
          'GOOGLE_REDIRECT_URI - OAuth redirect URI',
          'TOKEN_ENCRYPTION_KEY - Key for encrypting stored tokens (min 32 chars in production)'
        ],
        optional: [
          'NODE_ENV - Environment (development/test/production)',
          'PORT - Server port (default: 3000)',
          'LOG_LEVEL - Logging level (default: INFO)',
          'DEFAULT_TIMEZONE - Default timezone (default: America/Sao_Paulo)',
          'DEFAULT_EVENT_DURATION_MINUTES - Default event duration (default: 30)',
          'MAX_SYNC_RETRIES - Maximum sync retry attempts (default: 3)',
          'SYNC_RETRY_BASE_DELAY_MS - Base delay for retries (default: 1000)',
          'RATE_LIMIT_MAX_REQUESTS - Max requests per window (default: 60)',
          'RATE_LIMIT_WINDOW_MS - Rate limit window in ms (default: 60000)'
        ]
      },
      featureFlags: {
        'GOOGLE_CALENDAR_INTEGRATION_ENABLED': 'Enable/disable Google Calendar integration (default: true)',
        'SYNC_RETRY_ENABLED': 'Enable/disable sync retry mechanism (default: true)',
        'BACKGROUND_SYNC_ENABLED': 'Enable/disable background sync processing (default: true)',
        'ALERTING_ENABLED': 'Enable/disable alerting system (default: true)',
        'METRICS_COLLECTION_ENABLED': 'Enable/disable metrics collection (default: true)',
        'ENHANCED_LOGGING_ENABLED': 'Enable/disable enhanced logging (default: false)',
        'DEBUG_MODE_ENABLED': 'Enable/disable debug mode (default: false)'
      },
      examples: {
        development: `
# Development Environment
NODE_ENV=development
PORT=3000
LOG_LEVEL=DEBUG
DEBUG_MODE_ENABLED=true
ENHANCED_LOGGING_ENABLED=true
        `,
        production: `
# Production Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=INFO
TOKEN_ENCRYPTION_KEY=your-secure-32-character-key-here
GOOGLE_CALENDAR_INTEGRATION_ENABLED=true
METRICS_COLLECTION_ENABLED=true
        `
      }
    };
  }
}

// Create singleton instance
const configManager = new ConfigManager();

export default configManager;
export { ConfigManager };