/**
 * Abstract interface for WhatsApp messaging services
 * Defines the common operations that all WhatsApp service providers must implement
 */
export class WhatsAppServiceInterface {
  /**
   * Send a text message
   * @param {string} to - Recipient phone number (with whatsapp: prefix if needed)
   * @param {string} body - Message content
   * @returns {Promise<MessageResponse>} - Standardized response object
   */
  async sendTextMessage(to, body) {
    throw new Error('sendTextMessage must be implemented by subclass');
  }

  /**
   * Send a template message
   * @param {string} to - Recipient phone number (with whatsapp: prefix if needed)
   * @param {string} templateId - Template identifier (contentSid for Twilio, template name for Cloud API)
   * @param {object} variables - Template variables
   * @returns {Promise<MessageResponse>} - Standardized response object
   */
  async sendTemplateMessage(to, templateId, variables) {
    throw new Error('sendTemplateMessage must be implemented by subclass');
  }

  /**
   * Send a media message (image, document, etc.)
   * @param {string} to - Recipient phone number (with whatsapp: prefix if needed)
   * @param {string} mediaUrl - URL of the media to send
   * @param {string} caption - Optional caption for the media
   * @returns {Promise<MessageResponse>} - Standardized response object
   */
  async sendMediaMessage(to, mediaUrl, caption = '') {
    throw new Error('sendMediaMessage must be implemented by subclass');
  }

  /**
   * Send a report image (legacy method for backward compatibility)
   * @param {string} userId - User ID/phone number
   * @param {string} imageUrl - URL of the image to send
   * @returns {Promise<MessageResponse>} - Standardized response object
   */
  async sendReportImage(userId, imageUrl) {
    return this.sendMediaMessage(userId, imageUrl, "📊 Relatório de gastos");
  }

  /**
   * Validate service configuration
   * @returns {boolean} - True if configuration is valid
   */
  validateConfig() {
    throw new Error('validateConfig must be implemented by subclass');
  }

  /**
   * Get service provider name
   * @returns {string} - Provider name (e.g., 'twilio', 'cloud-api')
   */
  getProviderName() {
    throw new Error('getProviderName must be implemented by subclass');
  }
}