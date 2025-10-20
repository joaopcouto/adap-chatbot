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
      
            // WhatsApp Cloud API Configuration
      whatsappCloudApi: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WA_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WA_PHONE_NUMBER_ID,
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WA_VERIFY_TOKEN,
        apiVersion: process.env.WHATSAPP_API_VERSION || process.env.META_WA_VERSION || 'v18.0',
        baseUrl: process.env.WHATSAPP_CLOUD_API_URL || 'https://graph.facebook.com',
        maxRetries: parseInt(process.env.WHATSAPP_MAX_RETRIES) || 3,
        retryBaseDelayMs: parseInt(process.env.WHATSAPP_RETRY_BASE_DELAY_MS) || 1000,
        retryMaxDelayMs: parseInt(process.env.WHATSAPP_RETRY_MAX_DELAY_MS) || 30000,
        requestTimeoutMs: parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS) || 30000,
      },
      
      // OpenAI Configuration
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
      },
      
      // Audio Processing Configuration
      audioProcessing: {
        enabled: this.parseBoolean(process.env.AUDIO_PROCESSING_ENABLED, true),
        maxFileSize: parseInt(process.env.AUDIO_MAX_FILE_SIZE) || 16777216, // 16MB default
        processingTimeout: parseInt(process.env.AUDIO_PROCESSING_TIMEOUT) || 30000, // 30 seconds
        tempDir: process.env.AUDIO_TEMP_DIR || '/tmp',
        whisperModel: process.env.WHISPER_MODEL || 'whisper-1',
        whisperLanguage: process.env.WHISPER_LANGUAGE || 'pt',
        supportedMimeTypes: [
          'audio/ogg; codecs=opus',
          'audio/mp3',
          'audio/mpeg',
          'audio/wav',
          'audio/aac',
          'audio/m4a'
        ],
        maxDuration: 30, // seconds (WhatsApp limit)
        downloadTimeout: 15000, // 15 seconds for download
        transcriptionTimeout: 15000, // 15 seconds for transcription
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
      
      // Migration Configuration
      migration: {
        cloudApiTrafficPercentage: parseInt(process.env.WHATSAPP_CLOUD_API_TRAFFIC_PERCENTAGE) || 0,
        migrationBatchSize: parseInt(process.env.MIGRATION_BATCH_SIZE) || 100,
        migrationMonitoringInterval: parseInt(process.env.MIGRATION_MONITORING_INTERVAL_MS) || 60000, // 1 minute
        migrationRollbackThreshold: parseFloat(process.env.MIGRATION_ROLLBACK_THRESHOLD) || 0.05, // 5% error rate
        migrationValidationSampleSize: parseInt(process.env.MIGRATION_VALIDATION_SAMPLE_SIZE) || 50,
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
      whatsappCloudApiEnabled: this.parseBoolean(process.env.WHATSAPP_CLOUD_API_ENABLED, false),
      whatsappCloudApiMigrationMode: this.parseBoolean(process.env.WHATSAPP_CLOUD_API_MIGRATION_MODE, false),
      audioProcessingEnabled: this.parseBoolean(process.env.AUDIO_PROCESSING_ENABLED, true),
    };
  }

  /**
   * Validate required configuration values
   */
  validateConfiguration() {
    const requiredFields = [
      { path: 'mongoUri', name: 'MONGO_URI' },
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

    // Validate WhatsApp Cloud API configuration if enabled
    if (this.featureFlags.whatsappCloudApiEnabled || this.featureFlags.whatsappCloudApiMigrationMode) {
      requiredFields.push(
        { path: 'whatsappCloudApi.accessToken', name: 'WHATSAPP_ACCESS_TOKEN or META_WA_ACCESS_TOKEN' },
        { path: 'whatsappCloudApi.phoneNumberId', name: 'WHATSAPP_PHONE_NUMBER_ID or META_WA_PHONE_NUMBER_ID' },
        { path: 'whatsappCloudApi.webhookVerifyToken', name: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN or META_WA_VERIFY_TOKEN' }
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
    
    // Validate WhatsApp Cloud API numeric ranges
    this.validateNumericRange('whatsappCloudApi.maxRetries', 0, 10);
    this.validateNumericRange('whatsappCloudApi.retryBaseDelayMs', 100, 60000); // 100ms to 1 minute
    this.validateNumericRange('whatsappCloudApi.retryMaxDelayMs', 1000, 300000); // 1 second to 5 minutes
    this.validateNumericRange('whatsappCloudApi.requestTimeoutMs', 5000, 120000); // 5 seconds to 2 minutes

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

    // Validate WhatsApp Cloud API specific configurations
    this.validateWhatsAppCloudApiConfig();
    
    // Validate audio processing configuration
    this.validateAudioProcessingConfig();
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
   * Validate WhatsApp Cloud API specific configuration
   */
  validateWhatsAppCloudApiConfig() {
    if (!this.featureFlags.whatsappCloudApiEnabled && !this.featureFlags.whatsappCloudApiMigrationMode) {
      return; // Skip validation if Cloud API is not enabled
    }

    const cloudApiConfig = this.config.whatsappCloudApi;

    // Validate API version format
    if (cloudApiConfig.apiVersion && !cloudApiConfig.apiVersion.match(/^v\d+\.\d+$/)) {
      this.validationErrors.push(`Invalid WhatsApp API version format: ${cloudApiConfig.apiVersion}. Expected format: vX.Y (e.g., v18.0)`);
    }

    // Validate base URL format
    if (cloudApiConfig.baseUrl && !cloudApiConfig.baseUrl.match(/^https?:\/\/.+/)) {
      this.validationErrors.push(`Invalid WhatsApp Cloud API base URL: ${cloudApiConfig.baseUrl}. Must be a valid HTTP/HTTPS URL`);
    }

    // Validate phone number ID format (should be numeric)
    if (cloudApiConfig.phoneNumberId && !cloudApiConfig.phoneNumberId.match(/^\d+$/)) {
      this.validationErrors.push(`Invalid WhatsApp phone number ID: ${cloudApiConfig.phoneNumberId}. Must be numeric`);
    }

    // Validate access token format (should start with specific patterns for Meta tokens)
    if (cloudApiConfig.accessToken) {
      const token = cloudApiConfig.accessToken;
      if (!token.match(/^[A-Za-z0-9_-]+$/) || token.length < 50) {
        this.validationErrors.push('Invalid WhatsApp access token format. Token appears to be malformed or too short');
      }
    }

    // Validate webhook verify token (should be a secure random string)
    if (cloudApiConfig.webhookVerifyToken) {
      const token = cloudApiConfig.webhookVerifyToken;
      if (token.length < 16) {
        this.validationErrors.push('WhatsApp webhook verify token should be at least 16 characters long for security');
      }
    }

    // Validate retry configuration consistency
    if (cloudApiConfig.retryBaseDelayMs >= cloudApiConfig.retryMaxDelayMs) {
      this.validationErrors.push('WhatsApp retry base delay must be less than max delay');
    }

    // Warn about migration mode configuration
    if (this.featureFlags.whatsappCloudApiMigrationMode && !this.featureFlags.whatsappCloudApiEnabled) {
      structuredLogger.warn('WhatsApp Cloud API migration mode is enabled but Cloud API is disabled. This may cause issues during migration.');
    }
  }

  /**
   * Validate audio processing specific configuration
   */
  validateAudioProcessingConfig() {
    if (!this.featureFlags.audioProcessingEnabled) {
      return; // Skip validation if audio processing is not enabled
    }

    const audioConfig = this.config.audioProcessing;

    // Validate file size limits
    if (audioConfig.maxFileSize < 1024 || audioConfig.maxFileSize > 50 * 1024 * 1024) {
      this.validationErrors.push('Audio max file size must be between 1KB and 50MB');
    }

    // Validate timeout values
    if (audioConfig.processingTimeout < 5000 || audioConfig.processingTimeout > 120000) {
      this.validationErrors.push('Audio processing timeout must be between 5 seconds and 2 minutes');
    }

    if (audioConfig.downloadTimeout < 1000 || audioConfig.downloadTimeout > 60000) {
      this.validationErrors.push('Audio download timeout must be between 1 second and 1 minute');
    }

    if (audioConfig.transcriptionTimeout < 1000 || audioConfig.transcriptionTimeout > 60000) {
      this.validationErrors.push('Audio transcription timeout must be between 1 second and 1 minute');
    }

    // Validate Whisper model
    const validWhisperModels = ['whisper-1'];
    if (!validWhisperModels.includes(audioConfig.whisperModel)) {
      this.validationErrors.push(`Invalid Whisper model: ${audioConfig.whisperModel}. Valid models: ${validWhisperModels.join(', ')}`);
    }

    // Validate language code
    if (audioConfig.whisperLanguage && audioConfig.whisperLanguage.length !== 2) {
      this.validationErrors.push('Whisper language must be a 2-character ISO 639-1 language code (e.g., "pt", "en")');
    }

    // Validate temp directory (basic check)
    if (!audioConfig.tempDir || audioConfig.tempDir.trim() === '') {
      this.validationErrors.push('Audio temp directory must be specified');
    }

    // Validate max duration
    if (audioConfig.maxDuration < 1 || audioConfig.maxDuration > 300) {
      this.validationErrors.push('Audio max duration must be between 1 second and 5 minutes');
    }

    // Validate supported MIME types
    if (!Array.isArray(audioConfig.supportedMimeTypes) || audioConfig.supportedMimeTypes.length === 0) {
      this.validationErrors.push('At least one supported audio MIME type must be specified');
    }

    // Validate timeout consistency
    if (audioConfig.downloadTimeout + audioConfig.transcriptionTimeout > audioConfig.processingTimeout) {
      this.validationErrors.push('Sum of download and transcription timeouts cannot exceed total processing timeout');
    }

    // Require OpenAI API key if audio processing is enabled
    if (!this.config.openai.apiKey) {
      this.validationErrors.push('OpenAI API key is required when audio processing is enabled');
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
    if (sanitized.whatsappCloudApi) {
      sanitized.whatsappCloudApi.accessToken = '***';
      sanitized.whatsappCloudApi.webhookVerifyToken = '***';
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
   * Update migration configuration at runtime
   */
  updateMigrationConfig(key, value) {
    if (!(key in this.config.migration)) {
      throw new Error(`Unknown migration config key: ${key}`);
    }
    
    const oldValue = this.config.migration[key];
    
    // Validate the value based on the key
    switch (key) {
      case 'cloudApiTrafficPercentage':
        if (typeof value !== 'number' || value < 0 || value > 100) {
          throw new Error('Traffic percentage must be a number between 0 and 100');
        }
        break;
      case 'migrationBatchSize':
        if (typeof value !== 'number' || value < 1 || value > 1000) {
          throw new Error('Batch size must be a number between 1 and 1000');
        }
        break;
      case 'migrationMonitoringInterval':
        if (typeof value !== 'number' || value < 1000 || value > 3600000) {
          throw new Error('Monitoring interval must be between 1 second and 1 hour');
        }
        break;
      case 'migrationRollbackThreshold':
        if (typeof value !== 'number' || value < 0 || value > 1) {
          throw new Error('Rollback threshold must be a number between 0 and 1');
        }
        break;
      case 'migrationValidationSampleSize':
        if (typeof value !== 'number' || value < 1 || value > 1000) {
          throw new Error('Validation sample size must be between 1 and 1000');
        }
        break;
      default:
        throw new Error(`Validation not implemented for migration config key: ${key}`);
    }
    
    this.config.migration[key] = value;
    
    structuredLogger.info('Migration config updated', {
      key,
      oldValue,
      newValue: value,
      timestamp: new Date().toISOString()
    });
    
    return value;
  }

  /**
   * Get configuration documentation
   */
  getConfigurationDocs() {
    return {
      environmentVariables: {
        required: [
          'MONGO_URI - MongoDB connection string',
                                        'OPENAI_API_KEY - OpenAI API key for AI services'
        ],
        googleCalendarIntegration: [
          'GOOGLE_CLIENT_ID - Google OAuth client ID',
          'GOOGLE_CLIENT_SECRET - Google OAuth client secret',
          'GOOGLE_REDIRECT_URI - OAuth redirect URI',
          'TOKEN_ENCRYPTION_KEY - Key for encrypting stored tokens (min 32 chars in production)'
        ],
        whatsappCloudApi: [
          'WHATSAPP_ACCESS_TOKEN - WhatsApp Cloud API access token (or META_WA_ACCESS_TOKEN)',
          'WHATSAPP_PHONE_NUMBER_ID - WhatsApp phone number ID (or META_WA_PHONE_NUMBER_ID)',
          'WHATSAPP_WEBHOOK_VERIFY_TOKEN - Webhook verification token (or META_WA_VERIFY_TOKEN)',
          'WHATSAPP_BUSINESS_ACCOUNT_ID - WhatsApp Business Account ID (optional)',
          'WHATSAPP_API_VERSION - API version (default: v18.0, or META_WA_VERSION)',
          'WHATSAPP_CLOUD_API_URL - Base URL for Cloud API (default: https://graph.facebook.com)'
        ],
        audioProcessing: [
          'AUDIO_PROCESSING_ENABLED - Enable/disable audio message processing (default: true)',
          'AUDIO_MAX_FILE_SIZE - Maximum audio file size in bytes (default: 16777216 = 16MB)',
          'AUDIO_PROCESSING_TIMEOUT - Total timeout for audio processing in ms (default: 30000)',
          'AUDIO_TEMP_DIR - Directory for temporary audio files (default: /tmp)',
          'WHISPER_MODEL - OpenAI Whisper model to use (default: whisper-1)',
          'WHISPER_LANGUAGE - Language code for transcription (default: pt)'
        ],
        migration: [
          'WHATSAPP_CLOUD_API_TRAFFIC_PERCENTAGE - Percentage of traffic to route to Cloud API (0-100, default: 0)',
          'MIGRATION_BATCH_SIZE - Batch size for migration operations (default: 100)',
          'MIGRATION_MONITORING_INTERVAL_MS - Monitoring interval in milliseconds (default: 60000)',
          'MIGRATION_ROLLBACK_THRESHOLD - Error rate threshold for automatic rollback (0-1, default: 0.05)',
          'MIGRATION_VALIDATION_SAMPLE_SIZE - Sample size for validation (default: 50)'
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
          'RATE_LIMIT_WINDOW_MS - Rate limit window in ms (default: 60000)',
          'WHATSAPP_MAX_RETRIES - Max retry attempts for Cloud API (default: 3)',
          'WHATSAPP_RETRY_BASE_DELAY_MS - Base delay for Cloud API retries (default: 1000)',
          'WHATSAPP_RETRY_MAX_DELAY_MS - Max delay for Cloud API retries (default: 30000)',
          'WHATSAPP_REQUEST_TIMEOUT_MS - Request timeout for Cloud API (default: 30000)'
        ]
      },
      featureFlags: {
        'GOOGLE_CALENDAR_INTEGRATION_ENABLED': 'Enable/disable Google Calendar integration (default: true)',
        'SYNC_RETRY_ENABLED': 'Enable/disable sync retry mechanism (default: true)',
        'BACKGROUND_SYNC_ENABLED': 'Enable/disable background sync processing (default: true)',
        'ALERTING_ENABLED': 'Enable/disable alerting system (default: true)',
        'METRICS_COLLECTION_ENABLED': 'Enable/disable metrics collection (default: true)',
        'ENHANCED_LOGGING_ENABLED': 'Enable/disable enhanced logging (default: false)',
        'DEBUG_MODE_ENABLED': 'Enable/disable debug mode (default: false)',
        'WHATSAPP_CLOUD_API_ENABLED': 'Enable/disable WhatsApp Cloud API (default: false)',
        'WHATSAPP_CLOUD_API_MIGRATION_MODE': 'Enable migration mode for gradual Cloud API rollout (default: false)',
        'AUDIO_PROCESSING_ENABLED': 'Enable/disable audio message processing (default: true)'
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
        `,
        whatsappCloudApi: `
# WhatsApp Cloud API Configuration
WHATSAPP_CLOUD_API_ENABLED=true
WHATSAPP_ACCESS_TOKEN=your-cloud-api-access-token
WHATSAPP_PHONE_NUMBER_ID=1234567890123456
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-secure-webhook-verify-token
WHATSAPP_API_VERSION=v18.0
WHATSAPP_MAX_RETRIES=3
WHATSAPP_REQUEST_TIMEOUT_MS=30000

# Migration Mode (for gradual rollout)
WHATSAPP_CLOUD_API_MIGRATION_MODE=true
WHATSAPP_CLOUD_API_TRAFFIC_PERCENTAGE=10
MIGRATION_BATCH_SIZE=100
MIGRATION_MONITORING_INTERVAL_MS=60000
MIGRATION_ROLLBACK_THRESHOLD=0.05
MIGRATION_VALIDATION_SAMPLE_SIZE=50
        `,
        audioProcessing: `
# Audio Processing Configuration
AUDIO_PROCESSING_ENABLED=true
AUDIO_MAX_FILE_SIZE=16777216
AUDIO_PROCESSING_TIMEOUT=30000
AUDIO_TEMP_DIR=/tmp
WHISPER_MODEL=whisper-1
WHISPER_LANGUAGE=pt
        `
      }
    };
  }
}

// Create singleton instance
const configManager = new ConfigManager();

export default configManager;
export { ConfigManager };