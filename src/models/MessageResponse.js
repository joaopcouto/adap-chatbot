/**
 * Standardized message response format for all WhatsApp service providers
 */
export class MessageResponse {
  /**
   * Create a standardized message response
   * @param {object} options - Response options
   * @param {string} options.messageId - Unique message identifier
   * @param {string} options.status - Message status (sent, delivered, failed, etc.)
   * @param {string} options.provider - Service provider name
   * @param {object} options.rawResponse - Original provider response
   * @param {Date} options.timestamp - Message timestamp
   * @param {string} options.to - Recipient phone number
   * @param {string} options.error - Error message if failed
   */
  constructor({
    messageId,
    status = 'sent',
    provider,
    rawResponse = null,
    timestamp = new Date(),
    to = null,
    error = null
  }) {
    this.messageId = messageId;
    this.status = status;
    this.provider = provider;
    this.rawResponse = rawResponse;
    this.timestamp = timestamp;
    this.to = to;
    this.error = error;
    this.success = !error && status !== 'failed';
  }

  /**
   * Create a successful response from Twilio message
   * @param {object} twilioMessage - Twilio message response
   * @returns {MessageResponse}
   */
  static fromTwilioResponse(twilioMessage, to) {
    return new MessageResponse({
      messageId: twilioMessage.sid,
      status: twilioMessage.status || 'sent',
      provider: 'twilio',
      rawResponse: twilioMessage,
      to: to
    });
  }

  /**
   * Create a successful response from Cloud API message
   * @param {object} cloudApiResponse - Cloud API response
   * @param {string} to - Recipient phone number
   * @returns {MessageResponse}
   */
  static fromCloudApiResponse(cloudApiResponse, to) {
    const messageId = cloudApiResponse.messages?.[0]?.id;
    const status = cloudApiResponse.messages?.[0]?.message_status || 'sent';
    
    return new MessageResponse({
      messageId,
      status,
      provider: 'cloud-api',
      rawResponse: cloudApiResponse,
      to: to
    });
  }

  /**
   * Create an error response
   * @param {Error} error - Error object
   * @param {string} provider - Service provider name
   * @param {string} to - Recipient phone number
   * @returns {MessageResponse}
   */
  static fromError(error, provider, to) {
    return new MessageResponse({
      messageId: null,
      status: 'failed',
      provider,
      rawResponse: null,
      to: to,
      error: error.message || error.toString()
    });
  }

  /**
   * Create a test response for testing environments
   * @param {string} to - Recipient phone number
   * @param {string} provider - Service provider name
   * @returns {MessageResponse}
   */
  static createTestResponse(to, provider = 'test') {
    return new MessageResponse({
      messageId: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'sent',
      provider,
      to: to
    });
  }

  /**
   * Convert to JSON representation
   * @returns {object}
   */
  toJSON() {
    return {
      messageId: this.messageId,
      status: this.status,
      provider: this.provider,
      timestamp: this.timestamp,
      to: this.to,
      success: this.success,
      error: this.error
    };
  }

  /**
   * Get a human-readable string representation
   * @returns {string}
   */
  toString() {
    if (this.success) {
      return `Message ${this.messageId} sent successfully to ${this.to} via ${this.provider}`;
    } else {
      return `Message failed to ${this.to} via ${this.provider}: ${this.error}`;
    }
  }
}