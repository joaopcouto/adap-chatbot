import { WhatsAppServiceInterface } from './whatsappServiceInterface.js';
import { MessageResponse } from '../models/MessageResponse.js';
import { devLog } from "../helpers/logger.js";
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cloud API service adapter that implements the WhatsApp service interface
 * Provides integration with WhatsApp Cloud API
 */
export class CloudApiServiceAdapter extends WhatsAppServiceInterface {
  constructor({ testMode = false } = {}) {
    super();
    this.testMode = testMode;
    this.config = {
      baseUrl: process.env.WHATSAPP_CLOUD_API_URL || 'https://graph.facebook.com',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0'
    };
  }

  /**
   * Send a text message via Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} body - Message content
   * @returns {Promise<MessageResponse>}
   */
  async sendTextMessage(to, body) {
    if (this.testMode) {
      return this._sendTextMessageTest(to, body);
    }

    const payload = {
      messaging_product: "whatsapp",
      to: this._formatPhoneNumber(to),
      type: "text",
      text: {
        body: body
      }
    };

    try {
      const response = await this._makeApiCall('messages', payload);
      devLog(`Mensagem de texto enviada para ${to} via Cloud API`);
      return MessageResponse.fromCloudApiResponse(response, to);
    } catch (error) {
      devLog(`Erro ao enviar mensagem de texto via Cloud API: ${error}`);
      return MessageResponse.fromError(error, 'cloud-api', to);
    }
  }

  /**
   * Send a template message via Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} templateId - Template name
   * @param {object} variables - Template variables
   * @returns {Promise<MessageResponse>}
   */
  async sendTemplateMessage(to, templateId, variables) {
    if (this.testMode) {
      return this._sendTemplateMessageTest(to, templateId, variables);
    }

    // Convert variables object to Cloud API format
    const parameters = Object.values(variables).map(value => ({
      type: "text",
      text: String(value)
    }));

    const payload = {
      messaging_product: "whatsapp",
      to: this._formatPhoneNumber(to),
      type: "template",
      template: {
        name: templateId,
        language: {
          code: "pt_BR"
        },
        components: [
          {
            type: "body",
            parameters: parameters
          }
        ]
      }
    };

    try {
      const response = await this._makeApiCall('messages', payload);
      devLog(`Template ${templateId} enviado para ${to} via Cloud API`);
      return MessageResponse.fromCloudApiResponse(response, to);
    } catch (error) {
      devLog(`Erro ao enviar template via Cloud API: ${error}`);
      return MessageResponse.fromError(error, 'cloud-api', to);
    }
  }

  /**
   * Send a media message via Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} mediaUrl - URL of the media to send
   * @param {string} caption - Optional caption for the media
   * @returns {Promise<MessageResponse>}
   */
  async sendMediaMessage(to, mediaUrl, caption = '') {
    if (this.testMode) {
      return this._sendMediaMessageTest(to, mediaUrl, caption);
    }

    const payload = {
      messaging_product: "whatsapp",
      to: this._formatPhoneNumber(to),
      type: "image", // Assuming image for now, could be extended for other media types
      image: {
        link: mediaUrl,
        caption: caption
      }
    };

    try {
      const response = await this._makeApiCall('messages', payload);
      devLog(`Mensagem de mídia enviada para ${to} via Cloud API`);
      return MessageResponse.fromCloudApiResponse(response, to);
    } catch (error) {
      devLog(`Erro ao enviar mídia via Cloud API: ${error}`);
      return MessageResponse.fromError(error, 'cloud-api', to);
    }
  }

  /**
   * Validate Cloud API service configuration
   * @returns {boolean}
   */
  validateConfig() {
    const required = ['accessToken', 'phoneNumberId'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      devLog(`Credenciais da Cloud API não encontradas: ${missing.join(', ')}`);
      return false;
    }
    
    return true;
  }

  /**
   * Get service provider name
   * @returns {string}
   */
  getProviderName() {
    return 'cloud-api';
  }

  /**
   * Make API call to Cloud API
   * @param {string} endpoint - API endpoint
   * @param {object} payload - Request payload
   * @returns {Promise<object>} - API response
   * @private
   */
  async _makeApiCall(endpoint, payload) {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}/${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Cloud API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Format phone number for Cloud API (remove whatsapp: prefix if present)
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} - Formatted phone number
   * @private
   */
  _formatPhoneNumber(phoneNumber) {
    return phoneNumber.replace('whatsapp:', '');
  }

  /**
   * Test mode implementation for text messages
   * @param {string} to - Recipient phone number
   * @param {string} body - Message content
   * @returns {Promise<MessageResponse>}
   * @private
   */
  async _sendTextMessageTest(to, body) {
    console.log("--- MENSAGEM DE TESTE (Cloud API) ---");
    console.log(`DESTINO: ${to}`);
    console.log(`CONTEÚDO:\n${body}`);
    console.log("-------------------------------------\n");
    
    await new Promise(resolve => setTimeout(resolve, 100));
    return MessageResponse.createTestResponse(to, 'cloud-api');
  }

  /**
   * Test mode implementation for template messages
   * @param {string} to - Recipient phone number
   * @param {string} templateId - Template ID
   * @param {object} variables - Template variables
   * @returns {Promise<MessageResponse>}
   * @private
   */
  async _sendTemplateMessageTest(to, templateId, variables) {
    console.log("\n=================================================");
    console.log("===== 🚀 SIMULAÇÃO TEMPLATE (Cloud API) 🚀 =====");
    console.log("=================================================");
    console.log(`|-> 📲 Destinatário: ${to}`);
    console.log(`|-> 📄 Template: ${templateId}`);
    console.log(`|-> 📦 Variáveis:`);
    console.log(JSON.stringify(variables, null, 2)); 
    console.log("=================================================\n");

    return MessageResponse.createTestResponse(to, 'cloud-api');
  }

  /**
   * Test mode implementation for media messages
   * @param {string} to - Recipient phone number
   * @param {string} mediaUrl - Media URL
   * @param {string} caption - Media caption
   * @returns {Promise<MessageResponse>}
   * @private
   */
  async _sendMediaMessageTest(to, mediaUrl, caption) {
    console.log("--- MENSAGEM DE MÍDIA DE TESTE (Cloud API) ---");
    console.log(`DESTINO: ${to}`);
    console.log(`MÍDIA: ${mediaUrl}`);
    console.log(`LEGENDA: ${caption}`);
    console.log("----------------------------------------------\n");
    
    await new Promise(resolve => setTimeout(resolve, 100));
    return MessageResponse.createTestResponse(to, 'cloud-api');
  }
}