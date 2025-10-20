import axios from "axios";
import cloudApiConfig from "../config/cloudApiConfig.js";
import { structuredLogger, generateCorrelationId } from "../helpers/logger.js";
import { CloudApiError, cloudApiErrorHandler } from "./errorHandling/CloudApiErrorHandler.js";
import { RetryHandler, RetryHandlerFactory } from "./errorHandling/RetryHandler.js";
import { cloudApiMetricsCollector } from "./cloudApiMetricsCollector.js";

/**
 * WhatsApp Cloud API Service
 * Provides messaging functionality using the official WhatsApp Cloud API
 */
class CloudApiService {
  constructor(config = null) {
    this.config = config || cloudApiConfig;
    this.retryHandler = RetryHandlerFactory.createForCloudApi(this.config.getRetryConfig());
    this.errorHandler = cloudApiErrorHandler;
    this.metricsCollector = cloudApiMetricsCollector;
    this.correlationId = generateCorrelationId();
    this.validateService();

    structuredLogger.info("CloudApiService initialized", {
      correlationId: this.correlationId,
      apiVersion: this.config.getConfig().apiVersion,
      phoneNumberId: this.config.getConfig().phoneNumberId,
      enabled: this.config.isEnabled(),
      retryHandlerHealthy: this.retryHandler.isHealthy(),
      service: 'CloudApiService'
    });
  }

  /**
   * Validate service configuration and availability
   */
  validateService() {
    if (!this.config.isEnabled() && !this.config.isMigrationMode()) {
      throw new Error(
        "WhatsApp Cloud API is not enabled. Check WHATSAPP_CLOUD_API_ENABLED or WHATSAPP_CLOUD_API_MIGRATION_MODE environment variables."
      );
    }

    const configData = this.config.getConfig();
    if (!configData.accessToken || !configData.phoneNumberId) {
      throw new Error(
        "WhatsApp Cloud API configuration is incomplete. Missing access token or phone number ID."
      );
    }
  }

  /**
   * Make authenticated API call to WhatsApp Cloud API
   * @param {string} endpoint - API endpoint (e.g., 'messages')
   * @param {object} payload - Request payload
   * @param {string} method - HTTP method (default: 'POST')
   * @returns {Promise<object>} API response
   */
  async makeApiCall(endpoint, payload = null, method = "POST") {
    const url = this.config.getApiUrl(endpoint);
    const headers = this.config.getRequestHeaders();
    const timeoutConfig = this.config.getTimeoutConfig();

    const requestOptions = {
      method,
      url,
      headers,
      timeout: timeoutConfig.requestTimeoutMs,
      validateStatus: () => true, // Handle all status codes manually
    };

    if (payload && (method === "POST" || method === "PUT")) {
      requestOptions.data = payload;
    }

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    structuredLogger.cloudApiOperationStart('makeApiCall', {
      requestId,
      correlationId: this.correlationId,
      method,
      endpoint,
      url,
      hasPayload: !!payload,
      service: 'CloudApiService'
    });

    try {
      const response = await this.retryHandler.executeWithRetry(async () => {
        const res = await axios(requestOptions);

        if (res.status >= 400) {
          const errorData = res.data || { error: "Unknown error" };
          const error = new CloudApiError(
            errorData.error?.message || `HTTP ${res.status}`,
            res.status,
            errorData.error?.code,
            errorData.error?.fbtrace_id,
            errorData,
            { requestId, method, endpoint }
          );
          throw error;
        }

        return res;
      }, { requestId, method, endpoint });

      const duration = Date.now() - startTime;

      // Record metrics
      this.metricsCollector.recordRequest({
        endpoint,
        method,
        status: response.status,
        duration,
        operation: 'makeApiCall',
        success: true,
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationSuccess('makeApiCall', {
        requestId,
        correlationId: this.correlationId,
        method,
        endpoint,
        status: response.status,
        duration,
        messageId: response.data.messages?.[0]?.id,
        retryHandlerStats: this.retryHandler.getStats(),
        service: 'CloudApiService'
      });

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record error metrics
      this.metricsCollector.recordRequest({
        endpoint,
        method,
        status: error.status || 500,
        duration,
        operation: 'makeApiCall',
        success: false,
        requestId,
        correlationId: this.correlationId
      });

      this.metricsCollector.recordError({
        errorType: error.errorType || 'UNKNOWN_ERROR',
        errorCode: error.code,
        status: error.status,
        operation: 'makeApiCall',
        endpoint,
        requestId,
        correlationId: this.correlationId,
        isRateLimit: error.status === 429,
        isAuthFailure: error.status === 401 || error.status === 403,
        isNetworkError: !error.status
      });
      
      // Use centralized error handler
      const processedError = this.errorHandler.handleError(error, {
        requestId,
        correlationId: this.correlationId,
        method,
        endpoint,
        duration,
        operation: 'makeApiCall'
      });

      throw processedError;
    }
  }

  /**
   * Format phone number for Cloud API (without whatsapp: prefix)
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) {
      throw new Error("Phone number is required");
    }

    // Remove whatsapp: prefix if present (from Twilio format)
    let cleaned = phoneNumber.replace(/^whatsapp:/, "");

    // Remove all non-digit characters except +
    cleaned = cleaned.replace(/[^\d+]/g, "");

    // Remove + if present (Cloud API expects numbers without +)
    cleaned = cleaned.replace(/^\+/, "");

    // Add Brazil country code (55) if missing
    if (
      cleaned.length === 11 &&
      (cleaned.startsWith("11") || cleaned.startsWith("21"))
    ) {
      // Looks like a Brazilian number with area code, add country code
      cleaned = "55" + cleaned;
    } else if (cleaned.length === 10) {
      // Looks like a Brazilian number without area code, add default area code and country code
      cleaned = "5511" + cleaned;
    } else if (!cleaned.startsWith("55") && cleaned.length < 13) {
      // Add Brazil country code if not present and number seems incomplete
      cleaned = "55" + cleaned;
    }

    // Validate final format (should be 13 digits for Brazil: 55 + 2 digit area code + 9 digit number)
    if (cleaned.length < 10 || cleaned.length > 15) {
      throw new Error(
        `Invalid phone number format: ${phoneNumber}. Expected format: country code + area code + number`
      );
    }

    // Additional validation for Brazilian numbers
    if (cleaned.startsWith("55") && cleaned.length !== 13) {
      structuredLogger.warn("Unusual Brazilian phone number length", {
        originalNumber: phoneNumber,
        formattedNumber: cleaned,
        length: cleaned.length,
      });
    }

    return cleaned;
  }

  /**
   * Validate message content according to Cloud API limits
   * @param {string} content - Message content
   * @param {string} type - Message type ('text', 'caption')
   * @returns {boolean} True if valid
   */
  validateMessageContent(content, type = "text") {
    return this.config.validateMessageContent(content, type);
  }

  /**
   * Generate unique request ID for tracking
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get service health status
   * @returns {Promise<object>} Health status
   */
  async getHealthStatus() {
    try {
      const connectivityTest = await this.config.testConnectivity();
      const retryHandlerHealth = this.retryHandler.getHealthStatus();
      const errorStats = this.errorHandler.getErrorStats();
      
      return {
        service: "CloudApiService",
        status: connectivityTest.success && retryHandlerHealth.healthy ? "healthy" : "unhealthy",
        enabled: this.config.isEnabled(),
        migrationMode: this.config.isMigrationMode(),
        lastCheck: new Date().toISOString(),
        details: connectivityTest,
        retryHandler: retryHandlerHealth,
        errorHandling: {
          totalErrors: errorStats.totalErrors,
          lastUpdated: errorStats.lastUpdated
        }
      };
    } catch (error) {
      const processedError = this.errorHandler.handleError(error, {
        operation: 'getHealthStatus'
      });
      
      return {
        service: "CloudApiService",
        status: "unhealthy",
        enabled: this.config.isEnabled(),
        migrationMode: this.config.isMigrationMode(),
        lastCheck: new Date().toISOString(),
        error: processedError.message,
        errorType: processedError.errorType,
        retryHandler: this.retryHandler.getHealthStatus()
      };
    }
  }

  /**
   * Send text message via WhatsApp Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} body - Message text content
   * @returns {Promise<object>} Message response
   */
  async sendTextMessage(to, body) {
    if (!to || !body) {
      throw new Error("Recipient phone number and message body are required");
    }

    // Validate message content
    this.validateMessageContent(body, "text");

    // Format phone number for Cloud API
    const formattedNumber = this.formatPhoneNumber(to);

    // Prepare message payload according to Cloud API format
    const payload = {
      messaging_product: "whatsapp",
      to: formattedNumber,
      type: "text",
      text: {
        body: body,
      },
    };

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    structuredLogger.cloudApiOperationStart('sendTextMessage', {
      requestId,
      correlationId: this.correlationId,
      to: formattedNumber,
      messageLength: body.length,
      originalNumber: to,
      service: 'CloudApiService'
    });

    try {
      const response = await this.makeApiCall("messages", payload, "POST");
      const duration = Date.now() - startTime;

      const messageResponse = {
        messageId: response.messages?.[0]?.id,
        status: response.messages?.[0]?.message_status || "sent",
        timestamp: new Date().toISOString(),
        provider: "cloud-api",
        to: formattedNumber,
        type: "text",
        duration,
        requestId,
        rawResponse: response,
      };

      // Record message metrics
      this.metricsCollector.recordMessage({
        type: 'text',
        status: 'sent',
        messageId: messageResponse.messageId,
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationSuccess('sendTextMessage', {
        requestId,
        correlationId: this.correlationId,
        messageId: messageResponse.messageId,
        to: formattedNumber,
        status: messageResponse.status,
        duration,
        service: 'CloudApiService'
      });

      return messageResponse;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed message metrics
      this.metricsCollector.recordMessage({
        type: 'text',
        status: 'failed',
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationFailure('sendTextMessage', error, {
        requestId,
        correlationId: this.correlationId,
        to: formattedNumber,
        messageLength: body.length,
        duration,
        service: 'CloudApiService'
      });

      // Use centralized error handler
      const processedError = this.errorHandler.handleError(error, {
        operation: "sendTextMessage",
        to: formattedNumber,
        messageLength: body.length,
        requestId,
        correlationId: this.correlationId,
        duration,
      });

      throw processedError;
    }
  }

  /**
   * Send template message via WhatsApp Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} templateName - Template name/ID
   * @param {object} variables - Template variables
   * @param {string} languageCode - Language code (default: 'pt_BR')
   * @returns {Promise<object>} Message response
   */
  async sendTemplateMessage(
    to,
    templateName,
    variables = {},
    languageCode = "pt_BR"
  ) {
    if (!to || !templateName) {
      throw new Error("Recipient phone number and template name are required");
    }

    // Format phone number for Cloud API
    const formattedNumber = this.formatPhoneNumber(to);

    // Prepare template components based on variables
    const components = this.buildTemplateComponents(variables);

    // Prepare message payload according to Cloud API format
    const payload = {
      messaging_product: "whatsapp",
      to: formattedNumber,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components: components,
      },
    };

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    structuredLogger.cloudApiOperationStart('sendTemplateMessage', {
      requestId,
      correlationId: this.correlationId,
      to: formattedNumber,
      templateName,
      languageCode,
      variableCount: Object.keys(variables).length,
      originalNumber: to,
      service: 'CloudApiService'
    });

    try {
      const response = await this.makeApiCall("messages", payload, "POST");
      const duration = Date.now() - startTime;

      const messageResponse = {
        messageId: response.messages?.[0]?.id,
        status: response.messages?.[0]?.message_status || "sent",
        timestamp: new Date().toISOString(),
        provider: "cloud-api",
        to: formattedNumber,
        type: "template",
        templateName,
        languageCode,
        duration,
        requestId,
        rawResponse: response,
      };

      // Record message metrics
      this.metricsCollector.recordMessage({
        type: 'template',
        status: 'sent',
        messageId: messageResponse.messageId,
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationSuccess('sendTemplateMessage', {
        requestId,
        correlationId: this.correlationId,
        messageId: messageResponse.messageId,
        to: formattedNumber,
        templateName,
        status: messageResponse.status,
        duration,
        service: 'CloudApiService'
      });

      return messageResponse;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed message metrics
      this.metricsCollector.recordMessage({
        type: 'template',
        status: 'failed',
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationFailure('sendTemplateMessage', error, {
        requestId,
        correlationId: this.correlationId,
        to: formattedNumber,
        templateName,
        variableCount: Object.keys(variables).length,
        duration,
        service: 'CloudApiService'
      });

      // Use centralized error handler
      const processedError = this.errorHandler.handleError(error, {
        operation: "sendTemplateMessage",
        to: formattedNumber,
        templateName,
        variableCount: Object.keys(variables).length,
        requestId,
        correlationId: this.correlationId,
        duration,
      });

      throw processedError;
    }
  }

  /**
   * Build template components from variables
   * @param {object} variables - Template variables
   * @returns {Array} Template components
   */
  buildTemplateComponents(variables) {
    const components = [];

    // Handle body parameters
    if (variables.body && Array.isArray(variables.body)) {
      components.push({
        type: "body",
        parameters: variables.body.map((value) => ({
          type: this.getParameterType(value),
          text: String(value),
        })),
      });
    } else if (variables.body) {
      // Single body parameter
      components.push({
        type: "body",
        parameters: [
          {
            type: this.getParameterType(variables.body),
            text: String(variables.body),
          },
        ],
      });
    }

    // Handle header parameters
    if (variables.header) {
      if (Array.isArray(variables.header)) {
        components.push({
          type: "header",
          parameters: variables.header.map((value) => ({
            type: this.getParameterType(value),
            text: String(value),
          })),
        });
      } else {
        components.push({
          type: "header",
          parameters: [
            {
              type: this.getParameterType(variables.header),
              text: String(variables.header),
            },
          ],
        });
      }
    }

    // Handle button parameters (for interactive templates)
    if (variables.buttons && Array.isArray(variables.buttons)) {
      variables.buttons.forEach((button, index) => {
        if (button && typeof button === "object") {
          components.push({
            type: "button",
            sub_type: button.type || "quick_reply",
            index: index,
            parameters: [
              {
                type: "payload",
                payload:
                  button.payload || String(button.text || button.value || ""),
              },
            ],
          });
        }
      });
    }

    // If no components were built, create a simple body component
    if (components.length === 0 && Object.keys(variables).length > 0) {
      // Convert all variables to body parameters
      const bodyParams = Object.values(variables).map((value) => ({
        type: this.getParameterType(value),
        text: String(value),
      }));

      if (bodyParams.length > 0) {
        components.push({
          type: "body",
          parameters: bodyParams,
        });
      }
    }

    return components;
  }

  /**
   * Determine parameter type based on value
   * @param {any} value - Parameter value
   * @returns {string} Parameter type
   */
  getParameterType(value) {
    if (typeof value === "number") {
      return "text"; // Cloud API expects numbers as text
    }
    if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return "date_time"; // ISO date format
    }
    if (
      typeof value === "string" &&
      value.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|pdf|doc|docx)$/i)
    ) {
      return "document"; // URL to document/image
    }
    return "text"; // Default to text
  }

  /**
   * Send media message via WhatsApp Cloud API
   * @param {string} to - Recipient phone number
   * @param {string} mediaUrl - URL of the media file
   * @param {string} caption - Optional caption for the media
   * @param {string} mediaType - Media type ('image', 'document', 'video', 'audio')
   * @returns {Promise<object>} Message response
   */
  async sendMediaMessage(to, mediaUrl, caption = "", mediaType = "image") {
    if (!to || !mediaUrl) {
      throw new Error("Recipient phone number and media URL are required");
    }

    // Validate media URL
    this.validateMediaUrl(mediaUrl);

    // Validate caption if provided
    if (caption) {
      this.validateMessageContent(caption, "caption");
    }

    // Format phone number for Cloud API
    const formattedNumber = this.formatPhoneNumber(to);

    // Determine media type from URL if not specified
    const detectedMediaType = mediaType || this.detectMediaType(mediaUrl);

    // Prepare media object based on type
    const mediaObject = {
      link: mediaUrl,
    };

    // Add caption for supported media types
    if (caption && ["image", "document", "video"].includes(detectedMediaType)) {
      mediaObject.caption = caption;
    }

    // Prepare message payload according to Cloud API format
    const payload = {
      messaging_product: "whatsapp",
      to: formattedNumber,
      type: detectedMediaType,
      [detectedMediaType]: mediaObject,
    };

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    structuredLogger.cloudApiOperationStart('sendMediaMessage', {
      requestId,
      correlationId: this.correlationId,
      to: formattedNumber,
      mediaType: detectedMediaType,
      mediaUrl,
      hasCaption: !!caption,
      captionLength: caption ? caption.length : 0,
      originalNumber: to,
      service: 'CloudApiService'
    });

    try {
      const response = await this.makeApiCall("messages", payload, "POST");
      const duration = Date.now() - startTime;

      const messageResponse = {
        messageId: response.messages?.[0]?.id,
        status: response.messages?.[0]?.message_status || "sent",
        timestamp: new Date().toISOString(),
        provider: "cloud-api",
        to: formattedNumber,
        type: "media",
        mediaType: detectedMediaType,
        mediaUrl,
        caption,
        duration,
        requestId,
        rawResponse: response,
      };

      // Record message metrics
      this.metricsCollector.recordMessage({
        type: 'media',
        status: 'sent',
        messageId: messageResponse.messageId,
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationSuccess('sendMediaMessage', {
        requestId,
        correlationId: this.correlationId,
        messageId: messageResponse.messageId,
        to: formattedNumber,
        mediaType: detectedMediaType,
        status: messageResponse.status,
        duration,
        service: 'CloudApiService'
      });

      return messageResponse;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed message metrics
      this.metricsCollector.recordMessage({
        type: 'media',
        status: 'failed',
        operation: 'send',
        requestId,
        correlationId: this.correlationId
      });

      structuredLogger.cloudApiOperationFailure('sendMediaMessage', error, {
        requestId,
        correlationId: this.correlationId,
        to: formattedNumber,
        mediaType: detectedMediaType,
        mediaUrl,
        hasCaption: !!caption,
        duration,
        service: 'CloudApiService'
      });

      // Use centralized error handler
      const processedError = this.errorHandler.handleError(error, {
        operation: "sendMediaMessage",
        to: formattedNumber,
        mediaType: detectedMediaType,
        mediaUrl,
        hasCaption: !!caption,
        requestId,
        correlationId: this.correlationId,
        duration,
      });

      throw processedError;
    }
  }

  /**
   * Validate media URL format and accessibility
   * @param {string} mediaUrl - Media URL to validate
   * @returns {boolean} True if valid
   */
  validateMediaUrl(mediaUrl) {
    if (!mediaUrl || typeof mediaUrl !== "string") {
      throw new Error("Media URL must be a non-empty string");
    }

    // Check if URL is properly formatted
    try {
      const url = new URL(mediaUrl);

      // Must be HTTP or HTTPS
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Media URL must use HTTP or HTTPS protocol");
      }

      // Check for supported file extensions
      const supportedExtensions = [
        // Images
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        // Documents
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".txt",
        // Videos
        ".mp4",
        ".3gp",
        ".mov",
        ".avi",
        ".mkv",
        // Audio
        ".mp3",
        ".wav",
        ".ogg",
        ".aac",
        ".m4a",
      ];

      const pathname = url.pathname.toLowerCase();
      const hasValidExtension = supportedExtensions.some((ext) =>
        pathname.endsWith(ext)
      );

      if (!hasValidExtension) {
        structuredLogger.warn("Media URL has unsupported file extension", {
          mediaUrl,
          pathname,
          supportedExtensions,
        });
      }
    } catch (error) {
      throw new Error(`Invalid media URL format: ${error.message}`);
    }

    return true;
  }

  /**
   * Detect media type from URL
   * @param {string} mediaUrl - Media URL
   * @returns {string} Detected media type
   */
  detectMediaType(mediaUrl) {
    const url = mediaUrl.toLowerCase();

    // Image extensions
    if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/)) {
      return "image";
    }

    // Video extensions
    if (url.match(/\.(mp4|3gp|mov|avi|mkv)(\?.*)?$/)) {
      return "video";
    }

    // Audio extensions
    if (url.match(/\.(mp3|wav|ogg|aac|m4a)(\?.*)?$/)) {
      return "audio";
    }

    // Document extensions (default for unknown types)
    if (url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)(\?.*)?$/)) {
      return "document";
    }

    // Default to document for unknown file types
    structuredLogger.warn("Unknown media type, defaulting to document", {
      mediaUrl,
      detectedType: "document",
    });

    return "document";
  }

  /**
   * Get supported media types and their specifications
   * @returns {object} Media type specifications
   */
  getMediaTypeSpecs() {
    return {
      image: {
        maxSize: "5MB",
        supportedFormats: ["JPEG", "PNG", "GIF", "WebP"],
        extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
        supportsCaption: true,
      },
      video: {
        maxSize: "16MB",
        supportedFormats: ["MP4", "3GPP", "MOV", "AVI", "MKV"],
        extensions: [".mp4", ".3gp", ".mov", ".avi", ".mkv"],
        supportsCaption: true,
        maxDuration: "30 seconds",
      },
      audio: {
        maxSize: "16MB",
        supportedFormats: ["MP3", "WAV", "OGG", "AAC", "M4A"],
        extensions: [".mp3", ".wav", ".ogg", ".aac", ".m4a"],
        supportsCaption: false,
        maxDuration: "30 seconds",
      },
      document: {
        maxSize: "100MB",
        supportedFormats: [
          "PDF",
          "DOC",
          "DOCX",
          "XLS",
          "XLSX",
          "PPT",
          "PPTX",
          "TXT",
        ],
        extensions: [
          ".pdf",
          ".doc",
          ".docx",
          ".xls",
          ".xlsx",
          ".ppt",
          ".pptx",
          ".txt",
        ],
        supportsCaption: true,
      },
    };
  }

  /**
   * Download media from WhatsApp Cloud API using media ID
   * @param {string} mediaId - Media ID from webhook
   * @returns {Promise<object>} Media information and download URL
   */
  async downloadMedia(mediaId) {
    if (!mediaId) {
      throw new Error("Media ID is required");
    }

    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      structuredLogger.cloudApiOperationStart('downloadMedia', {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        service: 'CloudApiService'
      });

      // First, get media information
      const mediaInfo = await this.getMediaInfo(mediaId);
      
      structuredLogger.info("Media info obtained", {
        mediaId,
        mediaUrl: mediaInfo.url,
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        service: 'CloudApiService'
      });
      
      // Then download the actual media content
      const mediaContent = await this.downloadMediaContent(mediaInfo.url);

      const duration = Date.now() - startTime;

      structuredLogger.cloudApiOperationSuccess('downloadMedia', {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        duration,
        service: 'CloudApiService'
      });

      return {
        id: mediaId,
        url: mediaInfo.url,
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        content: mediaContent,
        downloadedAt: new Date().toISOString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      structuredLogger.cloudApiOperationFailure('downloadMedia', error, {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        duration,
        service: 'CloudApiService'
      });

      const processedError = this.errorHandler.handleError(error, {
        operation: "downloadMedia",
        mediaId,
        requestId,
        correlationId: this.correlationId,
        duration
      });

      throw processedError;
    }
  }

  /**
   * Get media information from WhatsApp Cloud API
   * @param {string} mediaId - Media ID from webhook
   * @returns {Promise<object>} Media information
   */
  async getMediaInfo(mediaId) {
    // Media endpoint uses different URL structure: /{version}/{mediaId}
    const baseUrl = this.config.getConfig().baseUrl.replace(/\/$/, '');
    const version = this.config.getConfig().apiVersion;
    const url = `${baseUrl}/${version}/${mediaId}`;
    const headers = this.config.getRequestHeaders();

    try {
      const response = await axios.get(url, { headers });
      return response.data;
    } catch (error) {
      structuredLogger.error("Failed to get media info", {
        mediaId,
        url,
        error: error.message,
        status: error.response?.status
      });
      throw new CloudApiError(
        `Failed to get media info: ${error.message}`,
        error.response?.status || 500,
        'MEDIA_INFO_FAILED'
      );
    }
  }

  /**
   * Download media content from the provided URL
   * @param {string} mediaUrl - Media URL from getMediaInfo
   * @returns {Promise<Buffer>} Media content as buffer
   */
  async downloadMediaContent(mediaUrl) {
    try {
      // Media URLs from WhatsApp API require authentication headers
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: this.config.getTimeoutConfig().requestTimeoutMs,
        headers: {
          'Authorization': `Bearer ${this.config.getConfig().accessToken}`,
          'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
        }
      });

      return Buffer.from(response.data);

    } catch (error) {
      structuredLogger.error("Failed to download media content", {
        mediaUrl,
        error: error.message,
        status: error.response?.status
      });
      throw new CloudApiError(
        `Failed to download media content: ${error.message}`,
        error.response?.status || 500,
        'MEDIA_DOWNLOAD_FAILED'
      );
    }
  }

  /**
   * Validate media content and extract metadata
   * @param {Buffer} mediaContent - Media content buffer
   * @param {string} mimeType - MIME type of the media
   * @returns {object} Validation result and metadata
   */
  validateMediaContent(mediaContent, mimeType) {
    const validation = {
      isValid: true,
      errors: [],
      metadata: {
        size: mediaContent.length,
        mimeType,
        type: this.getMediaTypeFromMime(mimeType)
      }
    };

    // Check file size limits
    const maxSizes = {
      'image': 5 * 1024 * 1024, // 5MB
      'audio': 16 * 1024 * 1024, // 16MB
      'video': 16 * 1024 * 1024, // 16MB
      'document': 100 * 1024 * 1024 // 100MB
    };

    const mediaType = validation.metadata.type;
    const maxSize = maxSizes[mediaType] || maxSizes.document;

    if (mediaContent.length > maxSize) {
      validation.isValid = false;
      validation.errors.push(`File size ${mediaContent.length} exceeds maximum ${maxSize} bytes for ${mediaType}`);
    }

    // Validate MIME type
    const allowedMimeTypes = this.getAllowedMimeTypes();
    if (!allowedMimeTypes.includes(mimeType)) {
      validation.isValid = false;
      validation.errors.push(`MIME type ${mimeType} is not supported`);
    }

    // Enhanced validation for audio files
    if (mediaType === 'audio') {
      const audioValidation = this.validateAudioFileContent(mediaContent, mimeType);
      validation.errors.push(...audioValidation.errors);
      validation.warnings = audioValidation.warnings || [];
      if (!audioValidation.isValid) {
        validation.isValid = false;
      }
      validation.metadata.audioMetadata = audioValidation.metadata;
    }

    return validation;
  }

  /**
   * Enhanced audio file validation with content analysis
   * @param {Buffer} audioContent - Audio content buffer
   * @param {string} mimeType - Audio MIME type
   * @returns {object} Audio-specific validation result
   */
  validateAudioFileContent(audioContent, mimeType) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {
        size: audioContent.length,
        mimeType,
        estimatedDuration: null,
        format: null
      }
    };

    const requestId = this.generateRequestId();

    structuredLogger.info('Starting audio file content validation', {
      requestId,
      correlationId: this.correlationId,
      mimeType,
      fileSize: audioContent.length,
      service: 'CloudApiService'
    });

    // Validate minimum file size (empty or corrupted files)
    const MIN_AUDIO_SIZE = 100; // 100 bytes minimum
    if (audioContent.length < MIN_AUDIO_SIZE) {
      validation.isValid = false;
      validation.errors.push(`Audio file too small (${audioContent.length} bytes). Minimum size is ${MIN_AUDIO_SIZE} bytes.`);
    }

    // Validate maximum file size for audio
    const MAX_AUDIO_SIZE = 16 * 1024 * 1024; // 16MB
    if (audioContent.length > MAX_AUDIO_SIZE) {
      validation.isValid = false;
      validation.errors.push(`Audio file too large (${audioContent.length} bytes). Maximum size is ${MAX_AUDIO_SIZE} bytes (16MB).`);
    }

    // Basic audio format validation based on file headers
    try {
      const formatValidation = this.validateAudioFormat(audioContent, mimeType);
      validation.metadata.format = formatValidation.format;
      validation.metadata.estimatedDuration = formatValidation.estimatedDuration;
      
      if (!formatValidation.isValid) {
        validation.warnings.push(...formatValidation.warnings);
        if (formatValidation.errors.length > 0) {
          validation.isValid = false;
          validation.errors.push(...formatValidation.errors);
        }
      }
    } catch (error) {
      structuredLogger.warn('Audio format validation failed', {
        requestId,
        correlationId: this.correlationId,
        error: error.message,
        mimeType,
        service: 'CloudApiService'
      });
      validation.warnings.push('Could not validate audio format - file may be corrupted or in an unusual format');
    }

    // Log validation results
    structuredLogger.info('Audio file content validation completed', {
      requestId,
      correlationId: this.correlationId,
      mimeType,
      fileSize: audioContent.length,
      isValid: validation.isValid,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      estimatedDuration: validation.metadata.estimatedDuration,
      service: 'CloudApiService'
    });

    return validation;
  }

  /**
   * Validate audio format based on file headers and content
   * @param {Buffer} audioContent - Audio content buffer
   * @param {string} mimeType - Expected MIME type
   * @returns {object} Format validation result
   */
  validateAudioFormat(audioContent, mimeType) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      format: null,
      estimatedDuration: null
    };

    // Check for common audio file signatures
    const audioSignatures = {
      'audio/mp3': [
        [0xFF, 0xFB], // MP3 frame header
        [0xFF, 0xF3], // MP3 frame header
        [0xFF, 0xF2], // MP3 frame header
        [0x49, 0x44, 0x33] // ID3 tag
      ],
      'audio/mpeg': [
        [0xFF, 0xFB], // MP3 frame header
        [0xFF, 0xF3], // MP3 frame header
        [0x49, 0x44, 0x33] // ID3 tag
      ],
      'audio/wav': [
        [0x52, 0x49, 0x46, 0x46] // RIFF header
      ],
      'audio/ogg': [
        [0x4F, 0x67, 0x67, 0x53] // OggS header
      ],
      'audio/aac': [
        [0xFF, 0xF1], // AAC ADTS header
        [0xFF, 0xF9]  // AAC ADTS header
      ],
      'audio/m4a': [
        [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70] // ftyp box
      ],
      'audio/mp4': [
        [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70] // ftyp box
      ]
    };

    // Get expected signatures for the MIME type
    const expectedSignatures = audioSignatures[mimeType] || [];
    
    if (expectedSignatures.length > 0) {
      let signatureFound = false;
      
      for (const signature of expectedSignatures) {
        if (audioContent.length >= signature.length) {
          const fileHeader = Array.from(audioContent.slice(0, signature.length));
          if (signature.every((byte, index) => byte === fileHeader[index])) {
            signatureFound = true;
            validation.format = mimeType;
            break;
          }
        }
      }

      if (!signatureFound) {
        validation.warnings.push(`Audio file header doesn't match expected format for ${mimeType}`);
      }
    } else {
      validation.warnings.push(`No signature validation available for ${mimeType}`);
    }

    // Estimate duration for common formats (rough estimation)
    try {
      if (mimeType === 'audio/wav' && audioContent.length > 44) {
        // WAV files have duration info in header
        const sampleRate = audioContent.readUInt32LE(24);
        const byteRate = audioContent.readUInt32LE(28);
        if (sampleRate > 0 && byteRate > 0) {
          const dataSize = audioContent.length - 44; // Approximate data size
          validation.estimatedDuration = Math.round(dataSize / byteRate);
        }
      } else {
        // Rough estimation based on file size and typical bitrates
        const avgBitrate = 128000; // 128 kbps average
        const estimatedSeconds = (audioContent.length * 8) / avgBitrate;
        validation.estimatedDuration = Math.round(estimatedSeconds);
      }

      // Check if estimated duration exceeds WhatsApp limits
      const MAX_DURATION = 30; // 30 seconds
      if (validation.estimatedDuration && validation.estimatedDuration > MAX_DURATION) {
        validation.warnings.push(`Estimated audio duration (${validation.estimatedDuration}s) may exceed WhatsApp limit of ${MAX_DURATION}s`);
      }
    } catch (error) {
      validation.warnings.push('Could not estimate audio duration');
    }

    return validation;
  }

  /**
   * Get audio processing timeout configuration
   * @param {number} fileSize - Audio file size in bytes
   * @returns {object} Timeout configuration
   */
  getAudioProcessingTimeouts(fileSize) {
    // Base timeout of 30 seconds, plus additional time based on file size
    const baseTimeout = 30000; // 30 seconds
    const sizeBasedTimeout = Math.min(fileSize / (1024 * 1024) * 5000, 30000); // 5s per MB, max 30s additional
    
    return {
      downloadTimeout: baseTimeout + sizeBasedTimeout,
      processingTimeout: 60000, // 60 seconds for transcription
      totalTimeout: baseTimeout + sizeBasedTimeout + 60000
    };
  }

  /**
   * Handle audio processing errors with specific error types and user-friendly messages
   * @param {Error} error - Original error
   * @param {object} context - Error context
   * @returns {CloudApiError} Processed error with audio-specific handling
   */
  handleAudioProcessingError(error, context = {}) {
    const requestId = context.requestId || this.generateRequestId();
    
    structuredLogger.error('Audio processing error occurred', {
      requestId,
      correlationId: this.correlationId,
      error: error.message,
      errorType: error.constructor.name,
      context,
      service: 'CloudApiService'
    });

    // Map common errors to user-friendly messages
    const errorMappings = {
      'ECONNABORTED': {
        message: 'Audio download timed out. Please try with a smaller audio file.',
        code: 'AUDIO_DOWNLOAD_TIMEOUT',
        status: 408
      },
      'ENOTFOUND': {
        message: 'Could not connect to audio service. Please try again later.',
        code: 'AUDIO_SERVICE_UNAVAILABLE',
        status: 503
      },
      'ECONNRESET': {
        message: 'Connection lost while downloading audio. Please try again.',
        code: 'AUDIO_CONNECTION_LOST',
        status: 503
      },
      'AUDIO_VALIDATION_FAILED': {
        message: 'Audio file format is not supported or file is corrupted.',
        code: 'AUDIO_VALIDATION_FAILED',
        status: 400
      },
      'AUDIO_TOO_LARGE': {
        message: 'Audio file is too large. Maximum size is 16MB.',
        code: 'AUDIO_TOO_LARGE',
        status: 413
      },
      'AUDIO_TOO_LONG': {
        message: 'Audio is too long. Maximum duration is 30 seconds.',
        code: 'AUDIO_TOO_LONG',
        status: 413
      }
    };

    const errorKey = error.code || error.message || 'UNKNOWN_ERROR';
    const errorMapping = errorMappings[errorKey] || {
      message: `Audio processing failed: ${error.message}`,
      code: 'AUDIO_PROCESSING_ERROR',
      status: 500
    };

    return new CloudApiError(
      errorMapping.message,
      errorMapping.status,
      errorMapping.code,
      context.traceId,
      { originalError: error.message, context },
      context
    );
  }

  /**
   * Get media type from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} Media type (image, audio, video, document)
   */
  getMediaTypeFromMime(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }

  /**
   * Get allowed MIME types for WhatsApp Cloud API
   * @returns {Array<string>} Array of allowed MIME types
   */
  getAllowedMimeTypes() {
    return [
      // Images
      'image/jpeg', 'image/png', 'image/webp',
      // Audio
      'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg',
      // Video
      'video/mp4', 'video/3gp',
      // Documents
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
  }

  /**
   * Download audio media with audio-specific validations
   * @param {string} mediaId - Media ID from webhook
   * @returns {Promise<object>} Audio media information and content
   */
  async downloadAudioMedia(mediaId) {
    if (!mediaId) {
      throw new Error("Media ID is required for audio download");
    }

    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      structuredLogger.cloudApiOperationStart('downloadAudioMedia', {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        service: 'CloudApiService'
      });

      // First, get media information
      const mediaInfo = await this.getMediaInfo(mediaId);
      
      // Validate that this is actually audio media
      if (!mediaInfo.mime_type || !mediaInfo.mime_type.startsWith('audio/')) {
        throw new CloudApiError(
          `Expected audio media, but received ${mediaInfo.mime_type}`,
          400,
          'INVALID_MEDIA_TYPE'
        );
      }

      // Validate audio media before downloading
      const validationResult = this.validateAudioMedia(mediaInfo);
      if (!validationResult.isValid) {
        throw new CloudApiError(
          `Audio validation failed: ${validationResult.errors.join(', ')}`,
          400,
          'AUDIO_VALIDATION_FAILED'
        );
      }

      // Download the actual media content with audio-specific timeout
      const mediaContent = await this.downloadAudioMediaContent(mediaInfo.url);

      const duration = Date.now() - startTime;

      structuredLogger.cloudApiOperationSuccess('downloadAudioMedia', {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        duration,
        validationPassed: true,
        service: 'CloudApiService'
      });

      return {
        id: mediaId,
        url: mediaInfo.url,
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        content: mediaContent,
        downloadedAt: new Date().toISOString(),
        validation: validationResult
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      structuredLogger.cloudApiOperationFailure('downloadAudioMedia', error, {
        requestId,
        correlationId: this.correlationId,
        mediaId,
        duration,
        service: 'CloudApiService'
      });

      const processedError = this.errorHandler.handleError(error, {
        operation: "downloadAudioMedia",
        mediaId,
        requestId,
        correlationId: this.correlationId,
        duration
      });

      throw processedError;
    }
  }

  /**
   * Validate audio media file size, format, and duration limits
   * @param {object} mediaInfo - Media information from getMediaInfo
   * @returns {object} Validation result with details
   */
  validateAudioMedia(mediaInfo) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {
        mimeType: mediaInfo.mime_type,
        fileSize: mediaInfo.file_size,
        id: mediaInfo.id
      }
    };

    // Define audio validation constants
    const AUDIO_LIMITS = {
      MAX_FILE_SIZE: 16 * 1024 * 1024, // 16MB (WhatsApp limit)
      MAX_DURATION: 30, // 30 seconds (WhatsApp limit)
      SUPPORTED_MIME_TYPES: [
        'audio/ogg; codecs=opus', // WhatsApp voice messages
        'audio/ogg',
        'audio/mp3',
        'audio/mpeg',
        'audio/wav',
        'audio/aac',
        'audio/m4a',
        'audio/mp4',
        'audio/amr'
      ]
    };

    // Validate MIME type
    if (!mediaInfo.mime_type) {
      validation.isValid = false;
      validation.errors.push('Missing MIME type information');
    } else if (!AUDIO_LIMITS.SUPPORTED_MIME_TYPES.includes(mediaInfo.mime_type)) {
      // Check if it's a supported audio type with different format
      const isAudioType = mediaInfo.mime_type.startsWith('audio/');
      if (!isAudioType) {
        validation.isValid = false;
        validation.errors.push(`Unsupported media type: ${mediaInfo.mime_type}. Expected audio format.`);
      } else {
        validation.warnings.push(`Audio format ${mediaInfo.mime_type} may not be fully supported. Supported formats: ${AUDIO_LIMITS.SUPPORTED_MIME_TYPES.join(', ')}`);
      }
    }

    // Validate file size
    if (!mediaInfo.file_size) {
      validation.warnings.push('File size information not available');
    } else if (mediaInfo.file_size > AUDIO_LIMITS.MAX_FILE_SIZE) {
      validation.isValid = false;
      validation.errors.push(`Audio file size ${mediaInfo.file_size} bytes exceeds maximum limit of ${AUDIO_LIMITS.MAX_FILE_SIZE} bytes (16MB)`);
    }

    // Add metadata about limits for reference
    validation.metadata.limits = AUDIO_LIMITS;

    structuredLogger.info('Audio media validation completed', {
      mediaId: mediaInfo.id,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
      isValid: validation.isValid,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      service: 'CloudApiService'
    });

    return validation;
  }

  /**
   * Download audio media content with audio-specific timeout handling
   * @param {string} mediaUrl - Media URL from getMediaInfo
   * @returns {Promise<Buffer>} Audio content as buffer
   */
  async downloadAudioMediaContent(mediaUrl) {
    try {
      // Use longer timeout for audio files as they can be larger
      const AUDIO_DOWNLOAD_TIMEOUT = 45000; // 45 seconds for audio downloads
      
      const response = await axios.get(mediaUrl, {
        headers: this.config.getRequestHeaders(),
        responseType: 'arraybuffer',
        timeout: AUDIO_DOWNLOAD_TIMEOUT
      });

      const audioBuffer = Buffer.from(response.data);

      structuredLogger.info("Audio media content downloaded successfully", {
        mediaUrl,
        contentLength: audioBuffer.length,
        contentType: response.headers['content-type'],
        service: 'CloudApiService'
      });

      return audioBuffer;

    } catch (error) {
      structuredLogger.error("Failed to download audio media content", {
        mediaUrl,
        error: error.message,
        status: error.response?.status,
        timeout: error.code === 'ECONNABORTED',
        service: 'CloudApiService'
      });

      // Provide more specific error messages for audio downloads
      let errorMessage = `Failed to download audio content: ${error.message}`;
      let errorCode = 'AUDIO_DOWNLOAD_FAILED';

      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Audio download timed out. The audio file may be too large or the connection is slow.';
        errorCode = 'AUDIO_DOWNLOAD_TIMEOUT';
      } else if (error.response?.status === 404) {
        errorMessage = 'Audio file not found. The media may have expired.';
        errorCode = 'AUDIO_NOT_FOUND';
      } else if (error.response?.status === 403) {
        errorMessage = 'Access denied to audio file. Check authentication credentials.';
        errorCode = 'AUDIO_ACCESS_DENIED';
      }

      throw new CloudApiError(
        errorMessage,
        error.response?.status || 500,
        errorCode
      );
    }
  }

  /**
   * Process media for existing workflows (compatibility with Twilio format)
   * @param {string} mediaId - Media ID from Cloud API webhook
   * @returns {Promise<string>} Media URL compatible with existing processing
   */
  async processMediaForCompatibility(mediaId) {
    try {
      const mediaData = await this.downloadMedia(mediaId);
      
      // For now, we'll return the original Cloud API URL
      // In a full implementation, you might want to:
      // 1. Upload to your own storage (S3, Cloudinary, etc.)
      // 2. Return a URL that existing processing can handle
      
      structuredLogger.info("Media processed for compatibility", {
        mediaId,
        mimeType: mediaData.mimeType,
        fileSize: mediaData.fileSize
      });

      return mediaData.url;

    } catch (error) {
      structuredLogger.error("Failed to process media for compatibility", {
        mediaId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get configuration summary
   * @returns {object} Configuration summary
   */
  getConfigSummary() {
    return this.config.getConfigSummary();
  }
}



export default CloudApiService;
export { CloudApiService };
