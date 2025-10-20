import crypto from 'crypto';

/**
 * Generate a correlation ID for tracking requests across services
 * @returns {string} Correlation ID
 */
export const generateCorrelationId = () => {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
};

/**
 * Log levels for structured logging
 */
export const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

/**
 * Structured logger for Google Calendar integration
 */
class StructuredLogger {
  constructor() {
    this.isProduction = process.env.NODE_ENV === 'prod';
    this.logLevel = process.env.LOG_LEVEL || 'INFO';
  }

  /**
   * Check if log level should be output
   * @param {string} level - Log level to check
   * @returns {boolean} True if should log
   */
  _shouldLog(level) {
    const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Format log entry with structured data
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} context - Additional context data
   * @returns {Object} Formatted log entry
   */
  _formatLogEntry(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    
    // Sanitize the entire context object first
    const sanitizedContext = this._sanitizeContext(context);
    
    const logEntry = {
      timestamp,
      level,
      message,
      service: this._determineService(context)
    };

    // Add sanitized context
    Object.assign(logEntry, sanitizedContext);

    // Ensure correlation ID is preserved (it's not sensitive)
    if (context.correlationId) {
      logEntry.correlationId = context.correlationId;
    }

    // Ensure request ID is preserved for Cloud API operations
    if (context.requestId) {
      logEntry.requestId = context.requestId;
    }

    // Add Cloud API specific fields
    if (context.provider === 'cloud-api' || context.operation?.includes('CloudApi') || context.service === 'CloudApiService') {
      logEntry.provider = 'cloud-api';
      logEntry.apiVersion = context.apiVersion || 'v18.0';
      
      // Add performance metrics if available
      if (context.duration !== undefined) {
        logEntry.performance = {
          duration: context.duration,
          timestamp: timestamp
        };
      }

      // Add Cloud API specific context
      if (context.messageId) logEntry.messageId = context.messageId;
      if (context.phoneNumberId) logEntry.phoneNumberId = context.phoneNumberId;
      if (context.businessAccountId) logEntry.businessAccountId = context.businessAccountId;
      if (context.templateName) logEntry.templateName = context.templateName;
      if (context.mediaType) logEntry.mediaType = context.mediaType;
      if (context.endpoint) logEntry.endpoint = context.endpoint;
      if (context.method) logEntry.method = context.method;
      if (context.status) logEntry.status = context.status;
    }

    // Additional sanitization for error objects
    if (logEntry.error && typeof logEntry.error === 'object') {
      logEntry.error = this._sanitizeError(logEntry.error);
    }

    return logEntry;
  }

  /**
   * Determine service name based on context
   * @param {Object} context - Log context
   * @returns {string} Service name
   */
  _determineService(context) {
    if (context.service) return context.service;
    if (context.provider === 'cloud-api') return 'whatsapp-cloud-api';
    if (context.operation?.includes('CloudApi')) return 'whatsapp-cloud-api';
    if (context.operation?.includes('Twilio')) return 'whatsapp-twilio';
    if (context.operation?.includes('GoogleCalendar')) return 'google-calendar-integration';
    return 'whatsapp-service';
  }

  /**
   * Sanitize error objects to remove sensitive information
   * @param {Error|Object} error - Error to sanitize
   * @returns {Object} Sanitized error
   */
  _sanitizeError(error) {
    const sanitized = {
      message: error.message,
      type: error.type || 'UNKNOWN_ERROR',
      status: error.status,
      retryable: error.retryable,
      requiresReconnection: error.requiresReconnection
    };

    // Include stack trace in non-production environments
    if (!this.isProduction && error.stack) {
      sanitized.stack = error.stack;
    }

    return sanitized;
  }

  /**
   * Sanitize context object to remove sensitive information
   * @param {Object} context - Context object to sanitize
   * @returns {Object} Sanitized context
   */
  _sanitizeContext(context) {
    if (!context || typeof context !== 'object') {
      return context;
    }

    const sensitiveKeys = [
      'accessToken', 'access_token',
      'refreshToken', 'refresh_token', 
      'token', 'password', 'secret',
      'authorization', 'auth',
      'phoneNumber', 'phone'
    ];

    const sanitized = {};
    
    for (const [key, value] of Object.entries(context)) {
      if (sensitiveKeys.some(sensitiveKey => 
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      )) {
        // Mask sensitive values
        if (typeof value === 'string') {
          if (key.toLowerCase().includes('phone')) {
            sanitized[key] = this._maskPhoneNumber(value);
          } else {
            sanitized[key] = this._maskToken(value);
          }
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key] = this._sanitizeContext(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Mask token values for logging
   * @param {string} token - Token to mask
   * @returns {string} Masked token
   */
  _maskToken(token) {
    if (!token || typeof token !== 'string') {
      return '[REDACTED]';
    }
    
    if (token.length <= 8) {
      return '*'.repeat(token.length);
    }
    
    const start = token.substring(0, 4);
    const end = token.substring(token.length - 4);
    const middle = '*'.repeat(token.length - 8);
    
    return `${start}${middle}${end}`;
  }

  /**
   * Mask phone number for logging (privacy protection)
   * @param {string} phoneNumber - Phone number to mask
   * @returns {string} Masked phone number
   */
  _maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 4) {
      return '***';
    }
    
    const start = phoneNumber.substring(0, 2);
    const end = phoneNumber.substring(phoneNumber.length - 2);
    const middle = '*'.repeat(phoneNumber.length - 4);
    
    return `${start}${middle}${end}`;
  }

  /**
   * Log error level messages
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  error(message, context = {}) {
    if (!this._shouldLog('ERROR')) return;

    const logEntry = this._formatLogEntry('ERROR', message, context);
    
    if (this.isProduction) {
      console.error(JSON.stringify(logEntry));
    } else {
      // Use sanitized context in non-production mode too
      const sanitizedContext = this._sanitizeContext(context);
      console.error(`[${logEntry.timestamp}] ERROR: ${message}`, sanitizedContext);
    }
  }

  /**
   * Log warning level messages
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    if (!this._shouldLog('WARN')) return;

    const logEntry = this._formatLogEntry('WARN', message, context);
    
    if (this.isProduction) {
      console.warn(JSON.stringify(logEntry));
    } else {
      // Use sanitized context in non-production mode too
      const sanitizedContext = this._sanitizeContext(context);
      console.warn(`[${logEntry.timestamp}] WARN: ${message}`, sanitizedContext);
    }
  }

  /**
   * Log info level messages
   * @param {string} message - Info message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    if (!this._shouldLog('INFO')) return;

    const logEntry = this._formatLogEntry('INFO', message, context);
    
    if (this.isProduction) {
      console.info(JSON.stringify(logEntry));
    } else {
      // Use sanitized context in non-production mode too
      const sanitizedContext = this._sanitizeContext(context);
      console.info(`[${logEntry.timestamp}] INFO: ${message}`, sanitizedContext);
    }
  }

  /**
   * Log debug level messages
   * @param {string} message - Debug message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    if (!this._shouldLog('DEBUG')) return;

    const logEntry = this._formatLogEntry('DEBUG', message, context);
    
    if (this.isProduction) {
      console.debug(JSON.stringify(logEntry));
    } else {
      // Use sanitized context in non-production mode too
      const sanitizedContext = this._sanitizeContext(context);
      console.debug(`[${logEntry.timestamp}] DEBUG: ${message}`, sanitizedContext);
    }
  }

  /**
   * Log sync operation start
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context
   */
  syncStart(operation, context = {}) {
    this.info(`Sync operation started: ${operation}`, {
      ...context,
      operation,
      phase: 'START'
    });
  }

  /**
   * Log sync operation success
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context
   */
  syncSuccess(operation, context = {}) {
    this.info(`Sync operation completed successfully: ${operation}`, {
      ...context,
      operation,
      phase: 'SUCCESS'
    });
  }

  /**
   * Log sync operation failure
   * @param {string} operation - Operation name
   * @param {Error} error - Error that occurred
   * @param {Object} context - Operation context
   */
  syncFailure(operation, error, context = {}) {
    this.error(`Sync operation failed: ${operation}`, {
      ...context,
      operation,
      phase: 'FAILURE',
      error: this._sanitizeError(error)
    });
  }

  /**
   * Log API call metrics
   * @param {string} endpoint - API endpoint called
   * @param {number} duration - Call duration in ms
   * @param {Object} context - Additional context
   */
  apiMetrics(endpoint, duration, context = {}) {
    this.info(`API call completed: ${endpoint}`, {
      ...context,
      endpoint,
      duration,
      type: 'API_METRICS'
    });
  }

  /**
   * Log user notification events
   * @param {string} userId - User ID
   * @param {string} notificationType - Type of notification
   * @param {Object} context - Additional context
   */
  userNotification(userId, notificationType, context = {}) {
    this.info(`User notification sent: ${notificationType}`, {
      ...context,
      userId,
      notificationType,
      type: 'USER_NOTIFICATION'
    });
  }

  /**
   * Log Cloud API operation start
   * @param {string} operation - Operation name (e.g., 'sendTextMessage', 'sendTemplateMessage')
   * @param {Object} context - Operation context
   */
  cloudApiOperationStart(operation, context = {}) {
    this.info(`Cloud API operation started: ${operation}`, {
      ...context,
      operation,
      provider: 'cloud-api',
      phase: 'START',
      type: 'CLOUD_API_OPERATION'
    });
  }

  /**
   * Log Cloud API operation success
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context including performance metrics
   */
  cloudApiOperationSuccess(operation, context = {}) {
    this.info(`Cloud API operation completed successfully: ${operation}`, {
      ...context,
      operation,
      provider: 'cloud-api',
      phase: 'SUCCESS',
      type: 'CLOUD_API_OPERATION'
    });
  }

  /**
   * Log Cloud API operation failure
   * @param {string} operation - Operation name
   * @param {Error} error - Error that occurred
   * @param {Object} context - Operation context
   */
  cloudApiOperationFailure(operation, error, context = {}) {
    this.error(`Cloud API operation failed: ${operation}`, {
      ...context,
      operation,
      provider: 'cloud-api',
      phase: 'FAILURE',
      type: 'CLOUD_API_OPERATION',
      error: this._sanitizeError(error)
    });
  }

  /**
   * Log Cloud API request metrics
   * @param {string} endpoint - API endpoint called
   * @param {string} method - HTTP method
   * @param {number} duration - Request duration in ms
   * @param {number} status - HTTP status code
   * @param {Object} context - Additional context
   */
  cloudApiRequestMetrics(endpoint, method, duration, status, context = {}) {
    const level = status >= 400 ? 'WARN' : 'INFO';
    const message = `Cloud API request completed: ${method} ${endpoint}`;
    
    this[level.toLowerCase()](message, {
      ...context,
      endpoint,
      method,
      duration,
      status,
      provider: 'cloud-api',
      type: 'API_METRICS',
      performance: {
        duration,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log Cloud API rate limiting events
   * @param {string} endpoint - API endpoint that was rate limited
   * @param {number} retryAfter - Seconds to wait before retry
   * @param {Object} context - Additional context
   */
  cloudApiRateLimit(endpoint, retryAfter, context = {}) {
    this.warn(`Cloud API rate limit hit: ${endpoint}`, {
      ...context,
      endpoint,
      retryAfter,
      provider: 'cloud-api',
      type: 'RATE_LIMIT',
      rateLimitInfo: {
        endpoint,
        retryAfter,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log Cloud API authentication events
   * @param {string} event - Authentication event (e.g., 'token_refresh', 'auth_failure')
   * @param {Object} context - Additional context
   */
  cloudApiAuth(event, context = {}) {
    const level = event.includes('failure') || event.includes('error') ? 'ERROR' : 'INFO';
    
    this[level](`Cloud API authentication event: ${event}`, {
      ...context,
      event,
      provider: 'cloud-api',
      type: 'AUTHENTICATION'
    });
  }

  /**
   * Log Cloud API webhook events
   * @param {string} event - Webhook event type
   * @param {Object} context - Webhook context
   */
  cloudApiWebhook(event, context = {}) {
    this.info(`Cloud API webhook received: ${event}`, {
      ...context,
      event,
      provider: 'cloud-api',
      type: 'WEBHOOK'
    });
  }

  /**
   * Log Cloud API message delivery status
   * @param {string} messageId - Message ID
   * @param {string} status - Delivery status
   * @param {Object} context - Additional context
   */
  cloudApiMessageStatus(messageId, status, context = {}) {
    const level = ['failed', 'undelivered'].includes(status) ? 'warn' : 'info';
    
    this[level](`Cloud API message status update: ${status}`, {
      ...context,
      messageId,
      status,
      provider: 'cloud-api',
      type: 'MESSAGE_STATUS'
    });
  }

  /**
   * Log Cloud API media processing events
   * @param {string} operation - Media operation (e.g., 'upload', 'download', 'validate')
   * @param {Object} context - Media context
   */
  cloudApiMedia(operation, context = {}) {
    this.info(`Cloud API media operation: ${operation}`, {
      ...context,
      operation,
      provider: 'cloud-api',
      type: 'MEDIA_PROCESSING'
    });
  }

  /**
   * Log performance metrics for Cloud API operations
   * @param {string} operation - Operation name
   * @param {Object} metrics - Performance metrics
   * @param {Object} context - Additional context
   */
  cloudApiPerformanceMetrics(operation, metrics, context = {}) {
    this.info(`Cloud API performance metrics: ${operation}`, {
      ...context,
      operation,
      provider: 'cloud-api',
      type: 'PERFORMANCE_METRICS',
      metrics: {
        ...metrics,
        timestamp: new Date().toISOString()
      }
    });
  }
}

// Create singleton instance
const structuredLogger = new StructuredLogger();

// Export structured logger
export { structuredLogger };

// Keep backward compatibility with existing devLog
export const devLog = (...args) => {
  if (process.env.NODE_ENV !== "prod") {
    console.log(...args);
  }
};
