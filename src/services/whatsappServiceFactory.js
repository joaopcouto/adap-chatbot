import { WhatsAppServiceInterface } from './whatsappServiceInterface.js';
import { devLog, structuredLogger } from '../helpers/logger.js';
import configManager from '../config/config.js';
import featureFlagService from './featureFlagService.js';

/**
 * Factory class for creating WhatsApp service instances
 * Implements the factory pattern to select the appropriate service provider
 */
export class WhatsAppServiceFactory {
  static _instance = null;
  static _serviceCache = new Map();

  /**
   * Get singleton instance of the factory
   * @returns {WhatsAppServiceFactory}
   */
  static getInstance() {
    if (!WhatsAppServiceFactory._instance) {
      WhatsAppServiceFactory._instance = new WhatsAppServiceFactory();
    }
    return WhatsAppServiceFactory._instance;
  }

  /**
   * Register a service provider
   * @param {string} providerName - Name of the provider (e.g., 'twilio', 'cloud-api')
   * @param {class} ServiceClass - Service class that extends WhatsAppServiceInterface
   */
  static registerProvider(providerName, ServiceClass) {
    if (!ServiceClass.prototype instanceof WhatsAppServiceInterface) {
      throw new Error(`Service class must extend WhatsAppServiceInterface`);
    }
    
    WhatsAppServiceFactory._serviceCache.set(providerName, ServiceClass);
    devLog(`WhatsApp service provider '${providerName}' registered`);
  }

  /**
   * Create a service instance based on configuration
   * @param {object} options - Service creation options
   * @param {string} options.provider - Provider name ('twilio', 'cloud-api', 'auto')
   * @param {boolean} options.testMode - Whether to use test mode
   * @param {object} options.config - Provider-specific configuration
   * @returns {WhatsAppServiceInterface} - Service instance
   */
  createService({ provider = 'auto', testMode = false, config = {} } = {}) {
    // Determine provider if set to auto
    if (provider === 'auto') {
      provider = this._determineProvider(config);
    }

    // Get service class from cache
    const ServiceClass = WhatsAppServiceFactory._serviceCache.get(provider);
    if (!ServiceClass) {
      throw new Error(`Unknown WhatsApp service provider: ${provider}`);
    }

    // Create and validate service instance
    const serviceInstance = new ServiceClass({ testMode, ...config });
    
    if (!serviceInstance.validateConfig()) {
      throw new Error(`Invalid configuration for ${provider} service`);
    }

    devLog(`Created WhatsApp service instance: ${provider} (test mode: ${testMode})`);
    return serviceInstance;
  }

  /**
   * Get the default service instance based on environment configuration
   * @returns {WhatsAppServiceInterface}
   */
  getDefaultService() {
    const provider = process.env.WHATSAPP_PROVIDER || 'auto';
    const testMode = process.env.NODE_ENV === 'test';
    
    return this.createService({ provider, testMode });
  }

  /**
   * Create a service for A/B testing
   * @param {string} userId - User ID for consistent routing
   * @param {number} cloudApiPercentage - Percentage of traffic to route to Cloud API (0-100)
   * @returns {WhatsAppServiceInterface}
   */
  createServiceForUser(userId, cloudApiPercentage = 0) {
    // Simple hash-based routing for consistent user experience
    const hash = this._hashUserId(userId);
    const useCloudApi = (hash % 100) < cloudApiPercentage;
    
    const provider = useCloudApi ? 'cloud-api' : 'twilio';
    const testMode = process.env.NODE_ENV === 'test';
    
    devLog(`User ${userId} routed to ${provider} (${cloudApiPercentage}% Cloud API traffic)`);
    return this.createService({ provider, testMode });
  }

  /**
   * Create service based on migration configuration
   * @param {string} userId - User ID for consistent routing
   * @param {object} options - Additional options
   * @returns {WhatsAppServiceInterface}
   */
  createServiceForMigration(userId, options = {}) {
    const migrationStatus = featureFlagService.getMigrationStatus();
    
    // If migration is not active, use default logic
    if (!migrationStatus.migrationMode) {
      if (migrationStatus.cloudApiEnabled) {
        return this.createService({ provider: 'cloud-api', ...options });
      } else {
        return this.createService({ provider: 'twilio', ...options });
      }
    }
    
    // Use migration traffic percentage for routing
    const trafficPercentage = migrationStatus.trafficPercentage;
    const service = this.createServiceForUser(userId, trafficPercentage);
    
    // Log migration routing decision
    structuredLogger.info('Migration service routing', {
      userId,
      trafficPercentage,
      provider: service.getProviderName(),
      migrationStatus: migrationStatus.status,
      timestamp: new Date().toISOString()
    });
    
    return service;
  }

  /**
   * Get service routing statistics
   * @param {string[]} userIds - Array of user IDs to test routing for
   * @returns {object} - Routing statistics
   */
  getRoutingStatistics(userIds) {
    const migrationStatus = featureFlagService.getMigrationStatus();
    const trafficPercentage = migrationStatus.trafficPercentage;
    
    let cloudApiCount = 0;
    let twilioCount = 0;
    
    for (const userId of userIds) {
      const hash = this._hashUserId(userId);
      const useCloudApi = (hash % 100) < trafficPercentage;
      
      if (useCloudApi) {
        cloudApiCount++;
      } else {
        twilioCount++;
      }
    }
    
    const total = userIds.length;
    const actualCloudApiPercentage = total > 0 ? (cloudApiCount / total) * 100 : 0;
    const actualTwilioPercentage = total > 0 ? (twilioCount / total) * 100 : 0;
    
    return {
      total,
      cloudApi: {
        count: cloudApiCount,
        percentage: actualCloudApiPercentage
      },
      twilio: {
        count: twilioCount,
        percentage: actualTwilioPercentage
      },
      expectedCloudApiPercentage: trafficPercentage,
      deviation: Math.abs(actualCloudApiPercentage - trafficPercentage),
      migrationStatus
    };
  }

  /**
   * Get list of registered providers
   * @returns {string[]} - Array of provider names
   */
  getRegisteredProviders() {
    return Array.from(WhatsAppServiceFactory._serviceCache.keys());
  }

  /**
   * Check if a provider is registered
   * @param {string} providerName - Provider name to check
   * @returns {boolean}
   */
  isProviderRegistered(providerName) {
    return WhatsAppServiceFactory._serviceCache.has(providerName);
  }

  /**
   * Determine the best provider based on available configuration
   * @param {object} config - Configuration object
   * @returns {string} - Provider name
   * @private
   */
  _determineProvider(config) {
    // Check for Cloud API configuration
    const hasCloudApiConfig = process.env.WHATSAPP_ACCESS_TOKEN && 
                             process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    const cloudApiEnabled = process.env.WHATSAPP_CLOUD_API_ENABLED === 'true';

    // Use Cloud API as the primary provider
    if (hasCloudApiConfig && cloudApiEnabled) {
      return 'cloud-api';
    }
    
    // If Cloud API is not enabled but we have config, still use it (post-migration)
    if (hasCloudApiConfig) {
      return 'cloud-api';
    }
    
    throw new Error('No WhatsApp service provider is properly configured. Please configure WhatsApp Cloud API.');
  }

  /**
   * Simple hash function for consistent user routing
   * @param {string} userId - User ID to hash
   * @returns {number} - Hash value
   * @private
   */
  _hashUserId(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clear service cache (useful for testing)
   * @static
   */
  static clearCache() {
    WhatsAppServiceFactory._serviceCache.clear();
    WhatsAppServiceFactory._instance = null;
  }
}