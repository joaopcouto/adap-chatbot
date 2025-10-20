import { WhatsAppServiceFactory } from './whatsappServiceFactory.js';
import { CloudApiServiceAdapter } from './cloudApiServiceAdapter.js';
import { devLog } from '../helpers/logger.js';

// Register service providers with the factory
WhatsAppServiceFactory.registerProvider('cloud-api', CloudApiServiceAdapter);

/**
 * Main WhatsApp service that provides backward compatibility
 * and feature flag support for gradual migration
 */
class WhatsAppService {
  constructor() {
    this.factory = WhatsAppServiceFactory.getInstance();
    this.currentService = null;
    this.initializeService();
  }

  /**
   * Initialize the service based on configuration and feature flags
   */
  initializeService() {
    try {
      // Check for feature flag configuration
      const migrationPercentage = parseInt(process.env.CLOUD_API_MIGRATION_PERCENTAGE || '0');
      const forceProvider = process.env.WHATSAPP_FORCE_PROVIDER;
      const migrationMode = process.env.WHATSAPP_CLOUD_API_MIGRATION_MODE === 'true';
      const cloudApiEnabled = process.env.WHATSAPP_CLOUD_API_ENABLED === 'true';
      
      if (forceProvider) {
        // Force specific provider (useful for testing)
        this.currentService = this.factory.createService({ provider: forceProvider });
        devLog(`WhatsApp service forced to use: ${forceProvider}`);
      } else if (migrationMode && migrationPercentage > 0) {
        // Use percentage-based routing for gradual migration
        this.currentService = this.factory.createServiceForUser('default', migrationPercentage);
        devLog(`WhatsApp service using gradual migration: ${migrationPercentage}% Cloud API`);
      } else if (cloudApiEnabled) {
        // Use Cloud API as primary service
        this.currentService = this.factory.createService({ provider: 'cloud-api' });
        devLog(`WhatsApp service using Cloud API as primary provider`);
      } else {
        // Use default service selection (auto-detect) - defaults to Cloud API post-migration
        this.currentService = this.factory.getDefaultService();
        devLog(`WhatsApp service using default provider: ${this.currentService.getProviderName()}`);
      }
    } catch (error) {
      devLog(`Error initializing WhatsApp service: ${error.message}`);
      throw new Error('No valid WhatsApp service configuration available');
    }
  }

  /**
   * Get service for specific user (for A/B testing)
   * @param {string} userId - User ID for consistent routing
   * @returns {WhatsAppServiceInterface}
   */
  getServiceForUser(userId) {
    const migrationPercentage = parseInt(process.env.CLOUD_API_MIGRATION_PERCENTAGE || '0');
    const forceProvider = process.env.WHATSAPP_FORCE_PROVIDER;
    const migrationMode = process.env.WHATSAPP_CLOUD_API_MIGRATION_MODE === 'true';
    const cloudApiEnabled = process.env.WHATSAPP_CLOUD_API_ENABLED === 'true';
    
    if (forceProvider) {
      return this.factory.createService({ provider: forceProvider });
    }
    
    if (migrationMode && migrationPercentage > 0) {
      return this.factory.createServiceForUser(userId, migrationPercentage);
    }
    
    if (cloudApiEnabled) {
      return this.factory.createService({ provider: 'cloud-api' });
    }
    
    // Default to current service
    return this.currentService;
  }

  /**
   * Send a text message
   * @param {string} to - Recipient phone number
   * @param {string} body - Message content
   * @returns {Promise<MessageResponse>}
   */
  async sendTextMessage(to, body) {
    return await this.currentService.sendTextMessage(to, body);
  }

  /**
   * Send a template message
   * @param {string} to - Recipient phone number
   * @param {string} templateId - Template identifier
   * @param {object} variables - Template variables
   * @returns {Promise<MessageResponse>}
   */
  async sendTemplateMessage(to, templateId, variables) {
    return await this.currentService.sendTemplateMessage(to, templateId, variables);
  }

  /**
   * Send a media message
   * @param {string} to - Recipient phone number
   * @param {string} mediaUrl - URL of the media to send
   * @param {string} caption - Optional caption for the media
   * @returns {Promise<MessageResponse>}
   */
  async sendMediaMessage(to, mediaUrl, caption = '') {
    return await this.currentService.sendMediaMessage(to, mediaUrl, caption);
  }

  /**
   * Send a report image (legacy method for backward compatibility)
   * @param {string} userId - User ID/phone number
   * @param {string} imageUrl - URL of the image to send
   * @returns {Promise<MessageResponse>}
   */
  async sendReportImage(userId, imageUrl) {
    return await this.currentService.sendReportImage(userId, imageUrl);
  }

  /**
   * Get current service provider name
   * @returns {string}
   */
  getCurrentProvider() {
    return this.currentService?.getProviderName() || 'unknown';
  }

  /**
   * Switch to a different provider (useful for testing and migration)
   * @param {string} provider - Provider name ('cloud-api')
   */
  switchProvider(provider) {
    try {
      this.currentService = this.factory.createService({ provider });
      devLog(`Switched WhatsApp service to: ${provider}`);
    } catch (error) {
      devLog(`Failed to switch to ${provider}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate current service configuration
   * @returns {boolean}
   */
  validateConfig() {
    return this.currentService?.validateConfig() || false;
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();

// Export functions for WhatsApp messaging
export async function sendTextMessage(to, body) {
  const response = await whatsappService.sendTextMessage(to, body);
  // Return the original format for backward compatibility
  return response.success ? { sid: response.messageId, status: response.status } : null;
}

export async function sendTemplateMessage(to, contentSid, variables) {
  const response = await whatsappService.sendTemplateMessage(to, contentSid, variables);
  // Return the original format for backward compatibility
  return response.success ? { sid: response.messageId, status: response.status } : null;
}

export async function sendReportImage(userId, imageUrl) {
  const response = await whatsappService.sendReportImage(userId, imageUrl);
  // Return void for backward compatibility (original function didn't return anything)
  if (!response.success) {
    console.error("Erro ao enviar mensagem:", response.error);
  } else {
    console.log(`✅ Mensagem enviada: ${response.messageId}`);
  }
}

// Test functions for backward compatibility
export async function sendTextMessageTEST(to, body) {
  const testService = whatsappService.factory.createService({ 
    provider: whatsappService.getCurrentProvider(), 
    testMode: true 
  });
  await testService.sendTextMessage(to, body);
  return Promise.resolve();
}

export async function sendTemplateMessageTEST(recipient, templateSid, variables) {
  const testService = whatsappService.factory.createService({ 
    provider: whatsappService.getCurrentProvider(), 
    testMode: true 
  });
  await testService.sendTemplateMessage(recipient, templateSid, variables);
  return Promise.resolve();
}

// Export the service instance for advanced usage
export { whatsappService };

// Export service classes for direct usage if needed
export { WhatsAppService, WhatsAppServiceFactory, CloudApiServiceAdapter };