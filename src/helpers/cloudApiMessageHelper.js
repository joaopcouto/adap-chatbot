import { structuredLogger } from "./logger.js";
import { CloudApiService } from "../services/cloudApiService.js";

/**
 * Send message via WhatsApp Cloud API with proper error handling and logging
 * @param {string} userPhoneNumber - Recipient phone number
 * @param {string} message - Message text to send
 * @returns {Promise<object>} Message response
 */
export async function sendCloudApiMessage(userPhoneNumber, message) {
  try {
    structuredLogger.info("sendCloudApiMessage called", {
      userPhoneNumber,
      messageLength: message.length,
      messagePreview: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      service: 'CloudApiMessageHelper'
    });

    // Initialize Cloud API service
    const cloudApiService = new CloudApiService();

    // Send message via Cloud API
    const response = await cloudApiService.sendTextMessage(userPhoneNumber, message);

    structuredLogger.info("Cloud API message sent successfully", {
      userPhoneNumber,
      messageId: response.messageId,
      status: response.status,
      duration: response.duration,
      service: 'CloudApiMessageHelper'
    });

    return response;
  } catch (error) {
    structuredLogger.error("Error sending Cloud API message", {
      error: error.message,
      errorType: error.errorType || 'UNKNOWN_ERROR',
      userPhoneNumber,
      messageLength: message?.length,
      service: 'CloudApiMessageHelper'
    });

    // Re-throw the error to allow calling code to handle it
    throw error;
  }
}