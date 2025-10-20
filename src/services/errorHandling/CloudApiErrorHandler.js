import { structuredLogger } from "../../helpers/logger.js";

/**
 * Cloud API Error Types and Classifications
 */
export const ERROR_TYPES = {
  // Authentication and Authorization
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  INVALID_ACCESS_TOKEN: 'INVALID_ACCESS_TOKEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  MESSAGING_LIMIT_EXCEEDED: 'MESSAGING_LIMIT_EXCEEDED',
  TEMPLATE_LIMIT_EXCEEDED: 'TEMPLATE_LIMIT_EXCEEDED',
  
  // Validation Errors
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  INVALID_MESSAGE_FORMAT: 'INVALID_MESSAGE_FORMAT',
  INVALID_TEMPLATE_PARAMETERS: 'INVALID_TEMPLATE_PARAMETERS',
  INVALID_MEDIA_URL: 'INVALID_MEDIA_URL',
  MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
  
  // Template Errors
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',
  TEMPLATE_PAUSED: 'TEMPLATE_PAUSED',
  TEMPLATE_PARAMETER_MISMATCH: 'TEMPLATE_PARAMETER_MISMATCH',
  
  // Media Errors
  MEDIA_DOWNLOAD_FAILED: 'MEDIA_DOWNLOAD_FAILED',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  MEDIA_UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED',
  
  // Network and Infrastructure
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Business Logic
  RECIPIENT_NOT_AVAILABLE: 'RECIPIENT_NOT_AVAILABLE',
  MESSAGE_DELIVERY_FAILED: 'MESSAGE_DELIVERY_FAILED',
  WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
  
  // Configuration
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  
  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Error Severity Levels
 */
export const ERROR_SEVERITY = {
  CRITICAL: 'CRITICAL',    // Service-breaking errors
  HIGH: 'HIGH',           // Feature-breaking errors
  MEDIUM: 'MEDIUM',       // Recoverable errors
  LOW: 'LOW'              // Minor issues
};

/**
 * Enhanced Cloud API Error class with comprehensive error handling
 */
export class CloudApiError extends Error {
  constructor(
    message,
    status = null,
    code = null,
    fbtraceId = null,
    rawResponse = null,
    context = {}
  ) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
    this.fbtraceId = fbtraceId;
    this.rawResponse = rawResponse;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Classify error type and severity
    this.errorType = this._classifyErrorType();
    this.severity = this._determineSeverity();
    this.retryable = this._isRetryable();
    this.userFriendlyMessage = this._generateUserFriendlyMessage();
    
    // Generate unique error ID for tracking
    this.errorId = this._generateErrorId();
  }

  /**
   * Classify error type based on status code and error details
   * @returns {string} Error type
   */
  _classifyErrorType() {
    // Authentication errors (401, 403)
    if (this.status === 401) {
      if (this.code === 190) return ERROR_TYPES.ACCESS_TOKEN_EXPIRED;
      return ERROR_TYPES.AUTHENTICATION_FAILED;
    }
    
    if (this.status === 403) {
      return ERROR_TYPES.INSUFFICIENT_PERMISSIONS;
    }

    // Rate limiting errors (429)
    if (this.status === 429) {
      if (this.code === 80007) return ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED;
      if (this.code === 131056) return ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED;
      return ERROR_TYPES.RATE_LIMIT_EXCEEDED;
    }

    // Validation errors (400)
    if (this.status === 400) {
      if (this.code === 1) return ERROR_TYPES.INVALID_PHONE_NUMBER;
      if (this.code === 100) return ERROR_TYPES.INVALID_MESSAGE_FORMAT;
      if (this.code === 132000) return ERROR_TYPES.TEMPLATE_NOT_FOUND;
      if (this.code === 132001) return ERROR_TYPES.TEMPLATE_NOT_APPROVED;
      if (this.code === 132005) return ERROR_TYPES.TEMPLATE_PAUSED;
      if (this.code === 132012) return ERROR_TYPES.TEMPLATE_PARAMETER_MISMATCH;
      if (this.code === 131014) return ERROR_TYPES.INVALID_MEDIA_URL;
      if (this.code === 131016) return ERROR_TYPES.MEDIA_TOO_LARGE;
      if (this.code === 131017) return ERROR_TYPES.UNSUPPORTED_MEDIA_TYPE;
      return ERROR_TYPES.INVALID_MESSAGE_FORMAT;
    }

    // Server errors (5xx)
    if (this.status >= 500) {
      if (this.status === 503) return ERROR_TYPES.SERVICE_UNAVAILABLE;
      return ERROR_TYPES.SERVER_ERROR;
    }

    // Network errors (no status)
    if (!this.status) {
      if (this.code === 'ECONNRESET' || this.code === 'ENOTFOUND' || 
          this.code === 'ECONNREFUSED' || this.code === 'ETIMEDOUT') {
        return ERROR_TYPES.NETWORK_ERROR;
      }
      if (this.code === 'TIMEOUT_ERROR') {
        return ERROR_TYPES.TIMEOUT_ERROR;
      }
    }

    return ERROR_TYPES.UNKNOWN_ERROR;
  }

  /**
   * Determine error severity based on type and impact
   * @returns {string} Error severity
   */
  _determineSeverity() {
    const criticalErrors = [
      ERROR_TYPES.AUTHENTICATION_FAILED,
      ERROR_TYPES.ACCESS_TOKEN_EXPIRED,
      ERROR_TYPES.INVALID_ACCESS_TOKEN,
      ERROR_TYPES.MISSING_CREDENTIALS,
      ERROR_TYPES.INVALID_CONFIGURATION
    ];

    const highSeverityErrors = [
      ERROR_TYPES.SERVICE_UNAVAILABLE,
      ERROR_TYPES.SERVER_ERROR,
      ERROR_TYPES.NETWORK_ERROR
    ];

    const mediumSeverityErrors = [
      ERROR_TYPES.RATE_LIMIT_EXCEEDED,
      ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED,
      ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED,
      ERROR_TYPES.TEMPLATE_NOT_APPROVED,
      ERROR_TYPES.MEDIA_DOWNLOAD_FAILED
    ];

    if (criticalErrors.includes(this.errorType)) {
      return ERROR_SEVERITY.CRITICAL;
    }
    
    if (highSeverityErrors.includes(this.errorType)) {
      return ERROR_SEVERITY.HIGH;
    }
    
    if (mediumSeverityErrors.includes(this.errorType)) {
      return ERROR_SEVERITY.MEDIUM;
    }

    return ERROR_SEVERITY.LOW;
  }

  /**
   * Determine if error is retryable
   * @returns {boolean} True if error should be retried
   */
  _isRetryable() {
    const retryableErrors = [
      ERROR_TYPES.RATE_LIMIT_EXCEEDED,
      ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED,
      ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED,
      ERROR_TYPES.NETWORK_ERROR,
      ERROR_TYPES.TIMEOUT_ERROR,
      ERROR_TYPES.SERVER_ERROR,
      ERROR_TYPES.SERVICE_UNAVAILABLE,
      ERROR_TYPES.MEDIA_DOWNLOAD_FAILED
    ];

    return retryableErrors.includes(this.errorType);
  }

  /**
   * Generate user-friendly error message
   * @returns {string} User-friendly message
   */
  _generateUserFriendlyMessage() {
    const messages = {
      [ERROR_TYPES.AUTHENTICATION_FAILED]: 'Falha na autenticação com WhatsApp. Verifique as credenciais.',
      [ERROR_TYPES.ACCESS_TOKEN_EXPIRED]: 'Token de acesso expirado. Renovando automaticamente.',
      [ERROR_TYPES.INVALID_ACCESS_TOKEN]: 'Token de acesso inválido. Verifique a configuração.',
      [ERROR_TYPES.INSUFFICIENT_PERMISSIONS]: 'Permissões insuficientes para esta operação.',
      
      [ERROR_TYPES.RATE_LIMIT_EXCEEDED]: 'Limite de taxa excedido. Tentando novamente em breve.',
      [ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED]: 'Limite de mensagens excedido. Aguarde antes de enviar mais.',
      [ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED]: 'Limite de templates excedido. Aguarde antes de enviar mais.',
      
      [ERROR_TYPES.INVALID_PHONE_NUMBER]: 'Número de telefone inválido.',
      [ERROR_TYPES.INVALID_MESSAGE_FORMAT]: 'Formato de mensagem inválido.',
      [ERROR_TYPES.MESSAGE_TOO_LONG]: 'Mensagem muito longa.',
      
      [ERROR_TYPES.TEMPLATE_NOT_FOUND]: 'Template não encontrado.',
      [ERROR_TYPES.TEMPLATE_NOT_APPROVED]: 'Template não aprovado pelo WhatsApp.',
      [ERROR_TYPES.TEMPLATE_PAUSED]: 'Template pausado temporariamente.',
      
      [ERROR_TYPES.INVALID_MEDIA_URL]: 'URL de mídia inválida.',
      [ERROR_TYPES.MEDIA_TOO_LARGE]: 'Arquivo de mídia muito grande.',
      [ERROR_TYPES.UNSUPPORTED_MEDIA_TYPE]: 'Tipo de mídia não suportado.',
      
      [ERROR_TYPES.NETWORK_ERROR]: 'Erro de conexão. Tentando novamente.',
      [ERROR_TYPES.SERVER_ERROR]: 'Erro interno do servidor. Tentando novamente.',
      [ERROR_TYPES.SERVICE_UNAVAILABLE]: 'Serviço temporariamente indisponível.',
      
      [ERROR_TYPES.RECIPIENT_NOT_AVAILABLE]: 'Destinatário não disponível no WhatsApp.',
      [ERROR_TYPES.MESSAGE_DELIVERY_FAILED]: 'Falha na entrega da mensagem.'
    };

    return messages[this.errorType] || 'Erro desconhecido. Entre em contato com o suporte.';
  }

  /**
   * Generate unique error ID for tracking
   * @returns {string} Error ID
   */
  _generateErrorId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `err_${timestamp}_${random}`;
  }

  /**
   * Get comprehensive error details for logging
   * @returns {object} Error details
   */
  getDetails() {
    return {
      errorId: this.errorId,
      errorType: this.errorType,
      severity: this.severity,
      message: this.message,
      userFriendlyMessage: this.userFriendlyMessage,
      status: this.status,
      code: this.code,
      fbtraceId: this.fbtraceId,
      timestamp: this.timestamp,
      retryable: this.retryable,
      context: this.context
    };
  }

  /**
   * Get retry delay based on error type
   * @returns {number} Delay in milliseconds
   */
  getRetryDelay() {
    const delays = {
      [ERROR_TYPES.RATE_LIMIT_EXCEEDED]: 60000,        // 1 minute
      [ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED]: 300000,  // 5 minutes
      [ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED]: 300000,   // 5 minutes
      [ERROR_TYPES.SERVER_ERROR]: 5000,                // 5 seconds
      [ERROR_TYPES.NETWORK_ERROR]: 2000,               // 2 seconds
      [ERROR_TYPES.TIMEOUT_ERROR]: 3000,               // 3 seconds
      [ERROR_TYPES.SERVICE_UNAVAILABLE]: 30000         // 30 seconds
    };

    return delays[this.errorType] || 1000; // Default 1 second
  }

  /**
   * Check if error requires immediate attention
   * @returns {boolean} True if requires immediate attention
   */
  requiresImmediateAttention() {
    return this.severity === ERROR_SEVERITY.CRITICAL;
  }

  /**
   * Get suggested action for error resolution
   * @returns {string} Suggested action
   */
  getSuggestedAction() {
    const actions = {
      [ERROR_TYPES.AUTHENTICATION_FAILED]: 'Verificar credenciais de acesso',
      [ERROR_TYPES.ACCESS_TOKEN_EXPIRED]: 'Renovar token de acesso',
      [ERROR_TYPES.INVALID_ACCESS_TOKEN]: 'Atualizar token de acesso',
      [ERROR_TYPES.INSUFFICIENT_PERMISSIONS]: 'Verificar permissões da aplicação',
      
      [ERROR_TYPES.RATE_LIMIT_EXCEEDED]: 'Implementar throttling de mensagens',
      [ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED]: 'Aguardar reset do limite',
      [ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED]: 'Aguardar reset do limite',
      
      [ERROR_TYPES.TEMPLATE_NOT_APPROVED]: 'Aprovar template no WhatsApp Business Manager',
      [ERROR_TYPES.TEMPLATE_PAUSED]: 'Verificar status do template',
      
      [ERROR_TYPES.INVALID_PHONE_NUMBER]: 'Validar formato do número',
      [ERROR_TYPES.INVALID_MEDIA_URL]: 'Verificar URL e acessibilidade',
      [ERROR_TYPES.MEDIA_TOO_LARGE]: 'Reduzir tamanho do arquivo',
      
      [ERROR_TYPES.NETWORK_ERROR]: 'Verificar conectividade',
      [ERROR_TYPES.SERVER_ERROR]: 'Aguardar resolução do servidor'
    };

    return actions[this.errorType] || 'Contatar suporte técnico';
  }
}

/**
 * Cloud API Error Handler - Centralized error processing and logging
 */
export class CloudApiErrorHandler {
  constructor() {
    this.errorStats = new Map();
    this.alertThresholds = {
      [ERROR_SEVERITY.CRITICAL]: 1,    // Alert immediately
      [ERROR_SEVERITY.HIGH]: 5,        // Alert after 5 occurrences
      [ERROR_SEVERITY.MEDIUM]: 10,     // Alert after 10 occurrences
      [ERROR_SEVERITY.LOW]: 50         // Alert after 50 occurrences
    };
  }

  /**
   * Process and handle Cloud API error
   * @param {Error} error - Error to process
   * @param {object} context - Additional context
   * @returns {CloudApiError} Processed error
   */
  handleError(error, context = {}) {
    let cloudApiError;

    // Convert to CloudApiError if not already
    if (error instanceof CloudApiError) {
      cloudApiError = error;
      // Merge additional context
      cloudApiError.context = { ...cloudApiError.context, ...context };
    } else {
      // Create CloudApiError from generic error
      cloudApiError = this._convertToCloudApiError(error, context);
    }

    // Log error with structured data
    this._logError(cloudApiError);

    // Update error statistics
    this._updateErrorStats(cloudApiError);

    // Check if alerting is needed
    this._checkAlertThresholds(cloudApiError);

    return cloudApiError;
  }

  /**
   * Convert generic error to CloudApiError
   * @param {Error} error - Generic error
   * @param {object} context - Error context
   * @returns {CloudApiError} Converted error
   */
  _convertToCloudApiError(error, context) {
    let status = null;
    let code = null;
    let fbtraceId = null;
    let rawResponse = null;

    // Extract details from axios error
    if (error.response) {
      status = error.response.status;
      rawResponse = error.response.data;
      
      if (rawResponse && rawResponse.error) {
        code = rawResponse.error.code;
        fbtraceId = rawResponse.error.fbtrace_id;
      }
    } else if (error.code) {
      code = error.code;
    }

    return new CloudApiError(
      error.message,
      status,
      code,
      fbtraceId,
      rawResponse,
      context
    );
  }

  /**
   * Log error with structured data for monitoring
   * @param {CloudApiError} error - Error to log
   */
  _logError(error) {
    const logContext = {
      errorId: error.errorId,
      errorType: error.errorType,
      severity: error.severity,
      status: error.status,
      code: error.code,
      fbtraceId: error.fbtraceId,
      retryable: error.retryable,
      context: error.context,
      suggestedAction: error.getSuggestedAction(),
      requiresAttention: error.requiresImmediateAttention()
    };

    // Log based on severity
    switch (error.severity) {
      case ERROR_SEVERITY.CRITICAL:
        structuredLogger.error(`CRITICAL Cloud API Error: ${error.message}`, logContext);
        break;
      case ERROR_SEVERITY.HIGH:
        structuredLogger.error(`HIGH severity Cloud API Error: ${error.message}`, logContext);
        break;
      case ERROR_SEVERITY.MEDIUM:
        structuredLogger.warn(`MEDIUM severity Cloud API Error: ${error.message}`, logContext);
        break;
      case ERROR_SEVERITY.LOW:
        structuredLogger.info(`LOW severity Cloud API Error: ${error.message}`, logContext);
        break;
      default:
        structuredLogger.error(`Cloud API Error: ${error.message}`, logContext);
    }
  }

  /**
   * Update error statistics for monitoring
   * @param {CloudApiError} error - Error to track
   */
  _updateErrorStats(error) {
    const key = `${error.errorType}_${error.severity}`;
    const current = this.errorStats.get(key) || { count: 0, lastOccurrence: null };
    
    this.errorStats.set(key, {
      count: current.count + 1,
      lastOccurrence: new Date().toISOString(),
      errorType: error.errorType,
      severity: error.severity
    });
  }

  /**
   * Check if error frequency exceeds alert thresholds
   * @param {CloudApiError} error - Error to check
   */
  _checkAlertThresholds(error) {
    const key = `${error.errorType}_${error.severity}`;
    const stats = this.errorStats.get(key);
    const threshold = this.alertThresholds[error.severity];

    if (stats && stats.count >= threshold) {
      this._triggerAlert(error, stats);
      
      // Reset counter after alerting
      this.errorStats.set(key, {
        ...stats,
        count: 0
      });
    }
  }

  /**
   * Trigger alert for high-frequency errors
   * @param {CloudApiError} error - Error that triggered alert
   * @param {object} stats - Error statistics
   */
  _triggerAlert(error, stats) {
    const alertContext = {
      errorType: error.errorType,
      severity: error.severity,
      occurrenceCount: stats.count,
      threshold: this.alertThresholds[error.severity],
      suggestedAction: error.getSuggestedAction(),
      requiresImmediateAttention: error.requiresImmediateAttention()
    };

    structuredLogger.error(`ALERT: High frequency Cloud API error detected`, alertContext);

    // Here you could integrate with alerting systems like:
    // - Slack notifications
    // - Email alerts
    // - PagerDuty
    // - Custom webhook notifications
  }

  /**
   * Get error statistics summary
   * @returns {object} Error statistics
   */
  getErrorStats() {
    const stats = {};
    
    for (const [key, value] of this.errorStats.entries()) {
      stats[key] = value;
    }

    return {
      totalErrors: Object.values(stats).reduce((sum, stat) => sum + stat.count, 0),
      errorsByType: stats,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Clear error statistics (useful for testing or periodic resets)
   */
  clearStats() {
    this.errorStats.clear();
  }

  /**
   * Set custom alert thresholds
   * @param {object} thresholds - Custom thresholds by severity
   */
  setAlertThresholds(thresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
  }
}

// Create singleton instance
export const cloudApiErrorHandler = new CloudApiErrorHandler();