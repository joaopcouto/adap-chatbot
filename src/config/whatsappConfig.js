import dotenv from 'dotenv';
import { devLog } from '../helpers/logger.js';

dotenv.config();

/**
 * WhatsApp service configuration management
 * Handles feature flags and provider selection logic
 */
export class WhatsAppConfig {
  constructor() {
    this.config = this._loadConfig();
    this._validateConfig();
  }

  /**
   * Load configuration from environment variables
   * @returns {object} Configuration object
   * @private
   */
  _loadConfig() {
    return {
      // Provider selection
      provider: process.env.WHATSAPP_PROVIDER || 'auto',
      forceProvider: process.env.WHATSAPP_FORCE_PROVIDER,
      preferCloudApi: process.env.PREFER_CLOUD_API === 'true',
      
      // Migration settings
      migrationPercentage: parseInt(process.env.CLOUD_API_MIGRATION_PERCENTAGE || '0'),
      enableABTesting: process.env.ENABLE_WHATSAPP_AB_TESTING === 'true',
      
            // Cloud API configuration
      cloudApi: {
        baseUrl: process.env.WHATSAPP_CLOUD_API_URL || 'https://graph.facebook.com',
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0'
      },
      
      // Feature flags
      features: {
        enableRetry: process.env.WHATSAPP_ENABLE_RETRY !== 'false',
        enableLogging: process.env.WHATSAPP_ENABLE_LOGGING !== 'false',
        enableMetrics: process.env.WHATSAPP_ENABLE_METRICS === 'true',
        maxRetries: parseInt(process.env.WHATSAPP_MAX_RETRIES || '3'),
        retryDelay: parseInt(process.env.WHATSAPP_RETRY_DELAY || '1000')
      },
      
      // Environment settings
      environment: process.env.NODE_ENV || 'development',
      testMode: process.env.NODE_ENV === 'test'
    };
  }

  /**
   * Validate configuration
   * @private
   */
  _validateConfig() {
    const errors = [];
    
    // Check if at least one provider is configured
    const hasTwilioConfig = this.config.twilio.accountSid && 
                           this.config.twilio.authToken && 
                           this.config.twilio.phoneNumber;
    
    const hasCloudApiConfig = this.config.cloudApi.accessToken && 
                             this.config.cloudApi.phoneNumberId;
    
    if (!hasTwilioConfig && !hasCloudApiConfig) {
      errors.push('No valid WhatsApp service configuration found. Configure either Twilio or Cloud API.');
    }
    
    // Validate migration percentage
    if (this.config.migrationPercentage < 0 || this.config.migrationPercentage > 100) {
      errors.push('CLOUD_API_MIGRATION_PERCENTAGE must be between 0 and 100');
    }
    
    // Validate forced provider
    if (this.config.forceProvider && !['twilio', 'cloud-api'].includes(this.config.forceProvider)) {
      errors.push('WHATSAPP_FORCE_PROVIDER must be either "twilio" or "cloud-api"');
    }
    
    if (errors.length > 0) {
      devLog(`WhatsApp configuration errors: ${errors.join(', ')}`);
      if (this.config.environment === 'production') {
        throw new Error(`Invalid WhatsApp configuration: ${errors.join(', ')}`);
      }
    }
  }

  /**
   * Get configuration for specific provider
   * @param {string} provider - Provider name ('twilio' or 'cloud-api')
   * @returns {object} Provider configuration
   */
  getProviderConfig(provider) {
    switch (provider) {
      case 'twilio':
        return this.config.twilio;
      case 'cloud-api':
        return this.config.cloudApi;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Check if provider is available
   * @param {string} provider - Provider name
   * @returns {boolean}
   */
  isProviderAvailable(provider) {
    const config = this.getProviderConfig(provider);
    
    switch (provider) {
      case 'twilio':
        return !!(config.accountSid && config.authToken && config.phoneNumber);
      case 'cloud-api':
        return !!(config.accessToken && config.phoneNumberId);
      default:
        return false;
    }
  }

  /**
   * Get the preferred provider based on configuration
   * @returns {string} Provider name
   */
  getPreferredProvider() {
    // Check for forced provider
    if (this.config.forceProvider) {
      return this.config.forceProvider;
    }
    
    // Check preference setting
    if (this.config.preferCloudApi && this.isProviderAvailable('cloud-api')) {
      return 'cloud-api';
    }
    
    // Default fallback logic
    if (this.isProviderAvailable('cloud-api')) {
      return 'cloud-api';
    } else if (this.isProviderAvailable('twilio')) {
      return 'twilio';
    }
    
    throw new Error('No available WhatsApp provider configured');
  }

  /**
   * Get migration percentage for A/B testing
   * @returns {number} Percentage (0-100)
   */
  getMigrationPercentage() {
    return this.config.migrationPercentage;
  }

  /**
   * Check if A/B testing is enabled
   * @returns {boolean}
   */
  isABTestingEnabled() {
    return this.config.enableABTesting && this.config.migrationPercentage > 0;
  }

  /**
   * Get feature flag value
   * @param {string} featureName - Feature name
   * @returns {any} Feature value
   */
  getFeature(featureName) {
    return this.config.features[featureName];
  }

  /**
   * Check if running in test mode
   * @returns {boolean}
   */
  isTestMode() {
    return this.config.testMode;
  }

  /**
   * Get full configuration object
   * @returns {object}
   */
  getFullConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration (useful for testing)
   * @param {object} updates - Configuration updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    this._validateConfig();
  }

  /**
   * Reset configuration to environment defaults
   */
  resetConfig() {
    this.config = this._loadConfig();
    this._validateConfig();
  }
}

// Export singleton instance
export const whatsappConfig = new WhatsAppConfig();

// Export configuration constants for easy access
export const PROVIDERS = {
  TWILIO: 'twilio',
  CLOUD_API: 'cloud-api'
};

export const FEATURES = {
  ENABLE_RETRY: 'enableRetry',
  ENABLE_LOGGING: 'enableLogging',
  ENABLE_METRICS: 'enableMetrics',
  MAX_RETRIES: 'maxRetries',
  RETRY_DELAY: 'retryDelay'
};