import configManager from './config.js';
import { structuredLogger } from '../helpers/logger.js';

/**
 * WhatsApp Cloud API Configuration Manager
 * Provides specialized configuration and validation for WhatsApp Cloud API
 */
class CloudApiConfigManager {
  constructor() {
    this.config = configManager.get('whatsappCloudApi');
    this.featureFlags = configManager.getFeatureFlags();
    this.validateCloudApiConfig();
  }

  /**
   * Get Cloud API configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Check if Cloud API is enabled
   */
  isEnabled() {
    return this.featureFlags.whatsappCloudApiEnabled === true;
  }

  /**
   * Check if migration mode is enabled
   */
  isMigrationMode() {
    return this.featureFlags.whatsappCloudApiMigrationMode === true;
  }

  /**
   * Get API endpoint URL for specific operation
   */
  getApiUrl(endpoint = '') {
    const baseUrl = this.config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    const version = this.config.apiVersion;
    const phoneNumberId = this.config.phoneNumberId;
    
    if (endpoint) {
      return `${baseUrl}/${version}/${phoneNumberId}/${endpoint}`;
    }
    return `${baseUrl}/${version}/${phoneNumberId}`;
  }

  /**
   * Get webhook verification URL
   */
  getWebhookUrl() {
    return `${this.config.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}/webhooks`;
  }

  /**
   * Get request headers for API calls
   */
  getRequestHeaders() {
    return {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
    };
  }

  /**
   * Get retry configuration
   */
  getRetryConfig() {
    return {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.retryBaseDelayMs,
      maxDelayMs: this.config.retryMaxDelayMs,
      backoffMultiplier: 2,
      jitterFactor: 0.1
    };
  }

  /**
   * Get request timeout configuration
   */
  getTimeoutConfig() {
    return {
      requestTimeoutMs: this.config.requestTimeoutMs,
      connectionTimeoutMs: Math.min(this.config.requestTimeoutMs / 2, 10000)
    };
  }

  /**
   * Validate Cloud API specific configuration
   */
  validateCloudApiConfig() {
    const errors = [];

    if (!this.isEnabled() && !this.isMigrationMode()) {
      // Skip validation if Cloud API is not enabled
      return;
    }

    // Validate required fields
    if (!this.config.accessToken) {
      errors.push('WhatsApp Cloud API access token is required');
    }

    if (!this.config.phoneNumberId) {
      errors.push('WhatsApp Cloud API phone number ID is required');
    }

    if (!this.config.webhookVerifyToken) {
      errors.push('WhatsApp Cloud API webhook verify token is required');
    }

    // Validate token formats
    if (this.config.accessToken && this.config.accessToken.length < 50) {
      errors.push('WhatsApp Cloud API access token appears to be too short');
    }

    if (this.config.phoneNumberId && !this.config.phoneNumberId.match(/^\d+$/)) {
      errors.push('WhatsApp Cloud API phone number ID must be numeric');
    }

    // Validate API version
    if (!this.config.apiVersion.match(/^v\d+\.\d+$/)) {
      errors.push(`Invalid API version format: ${this.config.apiVersion}`);
    }

    // Validate URL
    try {
      new URL(this.config.baseUrl);
    } catch (error) {
      errors.push(`Invalid base URL: ${this.config.baseUrl}`);
    }

    if (errors.length > 0) {
      structuredLogger.error('Cloud API configuration validation failed', { errors });
      throw new Error(`Cloud API configuration validation failed: ${errors.join(', ')}`);
    }

    structuredLogger.info('Cloud API configuration validated successfully', {
      apiVersion: this.config.apiVersion,
      phoneNumberId: this.config.phoneNumberId,
      enabled: this.isEnabled(),
      migrationMode: this.isMigrationMode()
    });
  }

  /**
   * Test Cloud API connectivity
   */
  async testConnectivity() {
    if (!this.isEnabled() && !this.isMigrationMode()) {
      throw new Error('Cloud API is not enabled');
    }

    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'GET',
        headers: this.getRequestHeaders(),
        timeout: 10000
      });

      if (response.ok) {
        structuredLogger.info('Cloud API connectivity test successful');
        return { success: true, status: response.status };
      } else {
        const error = await response.text();
        structuredLogger.error('Cloud API connectivity test failed', { 
          status: response.status, 
          error 
        });
        return { success: false, status: response.status, error };
      }
    } catch (error) {
      structuredLogger.error('Cloud API connectivity test error', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get configuration summary for monitoring
   */
  getConfigSummary() {
    return {
      enabled: this.isEnabled(),
      migrationMode: this.isMigrationMode(),
      apiVersion: this.config.apiVersion,
      baseUrl: this.config.baseUrl,
      phoneNumberId: this.config.phoneNumberId,
      maxRetries: this.config.maxRetries,
      requestTimeoutMs: this.config.requestTimeoutMs,
      hasAccessToken: !!this.config.accessToken,
      hasWebhookToken: !!this.config.webhookVerifyToken,
      hasBusinessAccountId: !!this.config.businessAccountId
    };
  }

  /**
   * Format phone number for Cloud API
   */
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // Add country code if missing (assuming Brazil +55 as default)
    if (cleaned.length === 11 && cleaned.startsWith('11')) {
      cleaned = '55' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '5511' + cleaned;
    } else if (!cleaned.startsWith('55') && cleaned.length < 13) {
      cleaned = '55' + cleaned;
    }

    // Validate final format
    if (cleaned.length < 10 || cleaned.length > 15) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    return cleaned;
  }

  /**
   * Validate message content for Cloud API limits
   */
  validateMessageContent(content, type = 'text') {
    const limits = {
      text: 4096,
      caption: 1024
    };

    const limit = limits[type] || limits.text;
    
    if (!content || typeof content !== 'string') {
      throw new Error('Message content must be a non-empty string');
    }

    if (content.length > limit) {
      throw new Error(`Message content exceeds ${limit} character limit for ${type} messages`);
    }

    return true;
  }
}

// Create singleton instance
const cloudApiConfig = new CloudApiConfigManager();

export default cloudApiConfig;
export { CloudApiConfigManager };