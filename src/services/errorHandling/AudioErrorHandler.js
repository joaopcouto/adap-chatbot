import { structuredLogger } from "../../helpers/logger.js";

/**
 * Audio Processing Error Types and Classifications
 */
export const AUDIO_ERROR_TYPES = {
  // Download Errors
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DOWNLOAD_TIMEOUT: 'DOWNLOAD_TIMEOUT',
  INVALID_MEDIA_ID: 'INVALID_MEDIA_ID',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  MEDIA_ACCESS_DENIED: 'MEDIA_ACCESS_DENIED',
  
  // Validation Errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  INVALID_AUDIO_FILE: 'INVALID_AUDIO_FILE',
  CORRUPTED_AUDIO: 'CORRUPTED_AUDIO',
  AUDIO_TOO_SHORT: 'AUDIO_TOO_SHORT',
  AUDIO_TOO_LONG: 'AUDIO_TOO_LONG',
  
  // Transcription Errors
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  TRANSCRIPTION_TIMEOUT: 'TRANSCRIPTION_TIMEOUT',
  TRANSCRIPTION_EMPTY: 'TRANSCRIPTION_EMPTY',
  TRANSCRIPTION_TOO_SHORT: 'TRANSCRIPTION_TOO_SHORT',
  POOR_AUDIO_QUALITY: 'POOR_AUDIO_QUALITY',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  
  // Service Errors
  OPENAI_API_ERROR: 'OPENAI_API_ERROR',
  OPENAI_RATE_LIMIT: 'OPENAI_RATE_LIMIT',
  OPENAI_QUOTA_EXCEEDED: 'OPENAI_QUOTA_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  
  // Processing Errors
  PROCESSING_TIMEOUT: 'PROCESSING_TIMEOUT',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
  CONCURRENT_LIMIT_EXCEEDED: 'CONCURRENT_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  
  // Network Errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  DNS_RESOLUTION_FAILED: 'DNS_RESOLUTION_FAILED',
  
  // Configuration Errors
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_API_KEY: 'INVALID_API_KEY',
  
  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Audio Error Severity Levels
 */
export const AUDIO_ERROR_SEVERITY = {
  CRITICAL: 'CRITICAL',    // Service-breaking errors
  HIGH: 'HIGH',           // Feature-breaking errors
  MEDIUM: 'MEDIUM',       // Recoverable errors
  LOW: 'LOW'              // Minor issues
};

/**
 * Enhanced Audio Processing Error class with comprehensive error handling
 */
export class AudioProcessingError extends Error {
  constructor(
    userMessage,
    errorType,
    originalError = null,
    context = {}
  ) {
    super(userMessage);
    this.name = "AudioProcessingError";
    this.userMessage = userMessage;
    this.errorType = errorType;
    this.originalError = originalError;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Classify error severity and properties
    this.severity = this._determineSeverity();
    this.retryable = this._isRetryable();
    this.requiresUserAction = this._requiresUserAction();
    this.technicalMessage = this._generateTechnicalMessage();
    
    // Generate unique error ID for tracking
    this.errorId = this._generateErrorId();
    
    // Extract additional details from original error
    this._extractOriginalErrorDetails();
  }

  /**
   * Determine error severity based on type and impact
   * @returns {string} Error severity
   */
  _determineSeverity() {
    const criticalErrors = [
      AUDIO_ERROR_TYPES.MISSING_API_KEY,
      AUDIO_ERROR_TYPES.INVALID_API_KEY,
      AUDIO_ERROR_TYPES.INVALID_CONFIGURATION,
      AUDIO_ERROR_TYPES.AUTHENTICATION_FAILED
    ];

    const highSeverityErrors = [
      AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE,
      AUDIO_ERROR_TYPES.OPENAI_API_ERROR,
      AUDIO_ERROR_TYPES.OPENAI_QUOTA_EXCEEDED,
      AUDIO_ERROR_TYPES.MEMORY_LIMIT_EXCEEDED,
      AUDIO_ERROR_TYPES.INTERNAL_ERROR
    ];

    const mediumSeverityErrors = [
      AUDIO_ERROR_TYPES.DOWNLOAD_FAILED,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED,
      AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT,
      AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT,
      AUDIO_ERROR_TYPES.NETWORK_ERROR,
      AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED
    ];

    if (criticalErrors.includes(this.errorType)) {
      return AUDIO_ERROR_SEVERITY.CRITICAL;
    }
    
    if (highSeverityErrors.includes(this.errorType)) {
      return AUDIO_ERROR_SEVERITY.HIGH;
    }
    
    if (mediumSeverityErrors.includes(this.errorType)) {
      return AUDIO_ERROR_SEVERITY.MEDIUM;
    }

    return AUDIO_ERROR_SEVERITY.LOW;
  }

  /**
   * Determine if error is retryable
   * @returns {boolean} True if error should be retried
   */
  _isRetryable() {
    const retryableErrors = [
      AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT,
      AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT,
      AUDIO_ERROR_TYPES.NETWORK_ERROR,
      AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT,
      AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE,
      AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT,
      AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED,
      AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED
    ];

    return retryableErrors.includes(this.errorType);
  }

  /**
   * Determine if error requires user action to resolve
   * @returns {boolean} True if user action is needed
   */
  _requiresUserAction() {
    const userActionErrors = [
      AUDIO_ERROR_TYPES.FILE_TOO_LARGE,
      AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT,
      AUDIO_ERROR_TYPES.AUDIO_TOO_SHORT,
      AUDIO_ERROR_TYPES.AUDIO_TOO_LONG,
      AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY,
      AUDIO_ERROR_TYPES.CORRUPTED_AUDIO,
      AUDIO_ERROR_TYPES.UNSUPPORTED_LANGUAGE
    ];

    return userActionErrors.includes(this.errorType);
  }

  /**
   * Generate technical error message for logging
   * @returns {string} Technical message
   */
  _generateTechnicalMessage() {
    const messages = {
      [AUDIO_ERROR_TYPES.DOWNLOAD_FAILED]: 'Failed to download audio media from WhatsApp Cloud API',
      [AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT]: 'Audio download exceeded timeout limit',
      [AUDIO_ERROR_TYPES.INVALID_MEDIA_ID]: 'Invalid or expired media ID provided',
      [AUDIO_ERROR_TYPES.MEDIA_NOT_FOUND]: 'Audio media not found on WhatsApp servers',
      [AUDIO_ERROR_TYPES.MEDIA_ACCESS_DENIED]: 'Access denied to audio media resource',
      
      [AUDIO_ERROR_TYPES.FILE_TOO_LARGE]: 'Audio file exceeds maximum size limit',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT]: 'Audio format not supported for transcription',
      [AUDIO_ERROR_TYPES.INVALID_AUDIO_FILE]: 'Invalid or corrupted audio file format',
      [AUDIO_ERROR_TYPES.CORRUPTED_AUDIO]: 'Audio file appears to be corrupted',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_SHORT]: 'Audio duration below minimum threshold',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_LONG]: 'Audio duration exceeds maximum threshold',
      
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED]: 'OpenAI Whisper transcription failed',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT]: 'Transcription process exceeded timeout',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY]: 'Transcription returned empty result',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TOO_SHORT]: 'Transcription result too short to be meaningful',
      [AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY]: 'Audio quality insufficient for transcription',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_LANGUAGE]: 'Audio language not supported by transcription service',
      
      [AUDIO_ERROR_TYPES.OPENAI_API_ERROR]: 'OpenAI API returned an error',
      [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 'OpenAI API rate limit exceeded',
      [AUDIO_ERROR_TYPES.OPENAI_QUOTA_EXCEEDED]: 'OpenAI API quota exceeded',
      [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 'Audio processing service temporarily unavailable',
      [AUDIO_ERROR_TYPES.AUTHENTICATION_FAILED]: 'Authentication failed with audio processing service',
      
      [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 'Audio processing exceeded maximum time limit',
      [AUDIO_ERROR_TYPES.MEMORY_LIMIT_EXCEEDED]: 'Audio processing exceeded memory limits',
      [AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED]: 'Too many concurrent audio processing requests',
      [AUDIO_ERROR_TYPES.INTERNAL_ERROR]: 'Internal audio processing error occurred',
      
      [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 'Network error during audio processing',
      [AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT]: 'Connection timeout during audio processing',
      [AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED]: 'DNS resolution failed for audio service',
      
      [AUDIO_ERROR_TYPES.INVALID_CONFIGURATION]: 'Invalid audio processing configuration',
      [AUDIO_ERROR_TYPES.MISSING_API_KEY]: 'Missing API key for audio processing service',
      [AUDIO_ERROR_TYPES.INVALID_API_KEY]: 'Invalid API key for audio processing service'
    };

    return messages[this.errorType] || 'Unknown audio processing error occurred';
  }

  /**
   * Extract additional details from original error
   */
  _extractOriginalErrorDetails() {
    if (!this.originalError) return;

    // Extract HTTP status and response details
    if (this.originalError.response) {
      this.httpStatus = this.originalError.response.status;
      this.httpStatusText = this.originalError.response.statusText;
      this.responseData = this.originalError.response.data;
    }

    // Extract network error details
    if (this.originalError.code) {
      this.networkCode = this.originalError.code;
    }

    // Extract OpenAI specific error details
    if (this.originalError.error) {
      this.openaiError = this.originalError.error;
    }

    // Extract stack trace for debugging
    this.originalStack = this.originalError.stack;
  }

  /**
   * Generate unique error ID for tracking
   * @returns {string} Error ID
   */
  _generateErrorId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `audio_err_${timestamp}_${random}`;
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
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      timestamp: this.timestamp,
      retryable: this.retryable,
      requiresUserAction: this.requiresUserAction,
      context: this.context,
      httpStatus: this.httpStatus,
      httpStatusText: this.httpStatusText,
      networkCode: this.networkCode,
      openaiError: this.openaiError,
      originalMessage: this.originalError?.message,
      suggestedAction: this.getSuggestedAction()
    };
  }

  /**
   * Get retry delay based on error type
   * @returns {number} Delay in milliseconds
   */
  getRetryDelay() {
    const delays = {
      [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 60000,           // 1 minute
      [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 30000,        // 30 seconds
      [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 5000,               // 5 seconds
      [AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT]: 3000,          // 3 seconds
      [AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT]: 2000,            // 2 seconds
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT]: 5000,       // 5 seconds
      [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 3000,          // 3 seconds
      [AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED]: 10000,      // 10 seconds
      [AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED]: 2000    // 2 seconds
    };

    return delays[this.errorType] || 1000; // Default 1 second
  }

  /**
   * Check if error requires immediate attention
   * @returns {boolean} True if requires immediate attention
   */
  requiresImmediateAttention() {
    return this.severity === AUDIO_ERROR_SEVERITY.CRITICAL;
  }

  /**
   * Get suggested action for error resolution
   * @returns {string} Suggested action
   */
  getSuggestedAction() {
    const actions = {
      [AUDIO_ERROR_TYPES.DOWNLOAD_FAILED]: 'Verificar conectividade e tentar novamente',
      [AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT]: 'Tentar com arquivo menor ou conexão mais rápida',
      [AUDIO_ERROR_TYPES.INVALID_MEDIA_ID]: 'Verificar validade do ID de mídia',
      [AUDIO_ERROR_TYPES.MEDIA_NOT_FOUND]: 'Verificar se o áudio ainda está disponível',
      [AUDIO_ERROR_TYPES.MEDIA_ACCESS_DENIED]: 'Verificar permissões de acesso à mídia',
      
      [AUDIO_ERROR_TYPES.FILE_TOO_LARGE]: 'Enviar áudio menor que 16MB',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT]: 'Converter para MP3, WAV ou OGG',
      [AUDIO_ERROR_TYPES.INVALID_AUDIO_FILE]: 'Verificar integridade do arquivo de áudio',
      [AUDIO_ERROR_TYPES.CORRUPTED_AUDIO]: 'Gravar novo áudio',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_SHORT]: 'Gravar áudio mais longo',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_LONG]: 'Gravar áudio mais curto (máximo 30 segundos)',
      
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED]: 'Tentar novamente ou usar mensagem de texto',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT]: 'Tentar com áudio mais curto',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY]: 'Falar mais alto e claramente',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TOO_SHORT]: 'Gravar mensagem mais longa',
      [AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY]: 'Gravar em ambiente mais silencioso',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_LANGUAGE]: 'Falar em português',
      
      [AUDIO_ERROR_TYPES.OPENAI_API_ERROR]: 'Verificar status da API OpenAI',
      [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 'Aguardar reset do limite da API',
      [AUDIO_ERROR_TYPES.OPENAI_QUOTA_EXCEEDED]: 'Verificar cota da API OpenAI',
      [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 'Aguardar restauração do serviço',
      [AUDIO_ERROR_TYPES.AUTHENTICATION_FAILED]: 'Verificar chave da API OpenAI',
      
      [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 'Tentar com áudio mais curto',
      [AUDIO_ERROR_TYPES.MEMORY_LIMIT_EXCEEDED]: 'Reduzir tamanho do arquivo',
      [AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED]: 'Aguardar e tentar novamente',
      [AUDIO_ERROR_TYPES.INTERNAL_ERROR]: 'Contatar suporte técnico',
      
      [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 'Verificar conectividade de rede',
      [AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT]: 'Verificar estabilidade da conexão',
      [AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED]: 'Verificar configuração DNS',
      
      [AUDIO_ERROR_TYPES.INVALID_CONFIGURATION]: 'Verificar configuração do serviço',
      [AUDIO_ERROR_TYPES.MISSING_API_KEY]: 'Configurar chave da API OpenAI',
      [AUDIO_ERROR_TYPES.INVALID_API_KEY]: 'Atualizar chave da API OpenAI'
    };

    return actions[this.errorType] || 'Contatar suporte técnico';
  }

  /**
   * Get user-friendly error messages in Portuguese
   * @returns {object} User messages for different contexts
   */
  static getUserMessages() {
    return {
      [AUDIO_ERROR_TYPES.DOWNLOAD_FAILED]: 'Não consegui baixar seu áudio. Tente enviar novamente.',
      [AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT]: 'O download do áudio demorou muito. Tente com um arquivo menor.',
      [AUDIO_ERROR_TYPES.INVALID_MEDIA_ID]: 'Áudio não encontrado. Tente enviar novamente.',
      [AUDIO_ERROR_TYPES.MEDIA_NOT_FOUND]: 'Áudio não está mais disponível. Envie novamente.',
      [AUDIO_ERROR_TYPES.MEDIA_ACCESS_DENIED]: 'Não consegui acessar seu áudio. Tente novamente.',
      
      [AUDIO_ERROR_TYPES.FILE_TOO_LARGE]: 'Seu áudio é muito grande. Envie um áudio de até 16MB.',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT]: 'Formato de áudio não suportado. Use MP3, WAV ou OGG.',
      [AUDIO_ERROR_TYPES.INVALID_AUDIO_FILE]: 'Arquivo de áudio inválido. Tente gravar novamente.',
      [AUDIO_ERROR_TYPES.CORRUPTED_AUDIO]: 'Áudio corrompido. Grave uma nova mensagem.',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_SHORT]: 'Áudio muito curto. Grave uma mensagem mais longa.',
      [AUDIO_ERROR_TYPES.AUDIO_TOO_LONG]: 'Áudio muito longo. Grave uma mensagem de até 30 segundos.',
      
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED]: 'Não consegui entender seu áudio. Tente falar mais claramente ou envie uma mensagem de texto.',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT]: 'Processamento do áudio demorou muito. Tente com um áudio mais curto.',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY]: 'Seu áudio está muito baixo ou sem fala. Tente gravar novamente.',
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TOO_SHORT]: 'Não consegui entender seu áudio. Tente falar mais claramente.',
      [AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY]: 'Qualidade do áudio muito baixa. Tente gravar em um local mais silencioso.',
      [AUDIO_ERROR_TYPES.UNSUPPORTED_LANGUAGE]: 'Idioma não suportado. Fale em português.',
      
      [AUDIO_ERROR_TYPES.OPENAI_API_ERROR]: 'Erro no serviço de transcrição. Tente novamente em alguns minutos.',
      [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 'Muitas solicitações de áudio. Aguarde um momento e tente novamente.',
      [AUDIO_ERROR_TYPES.OPENAI_QUOTA_EXCEEDED]: 'Limite de processamento de áudio atingido. Tente novamente mais tarde.',
      [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 'Serviço de áudio temporariamente indisponível. Tente novamente em alguns minutos.',
      [AUDIO_ERROR_TYPES.AUTHENTICATION_FAILED]: 'Erro de autenticação no serviço de áudio. Contate o suporte.',
      
      [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 'Processamento do áudio demorou muito. Tente com um áudio mais curto.',
      [AUDIO_ERROR_TYPES.MEMORY_LIMIT_EXCEEDED]: 'Áudio muito grande para processar. Tente com um arquivo menor.',
      [AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED]: 'Muitas solicitações simultâneas. Aguarde um momento e tente novamente.',
      [AUDIO_ERROR_TYPES.INTERNAL_ERROR]: 'Erro interno no processamento de áudio. Tente novamente ou envie uma mensagem de texto.',
      
      [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 'Erro de conexão ao processar áudio. Tente novamente.',
      [AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT]: 'Conexão muito lenta. Tente novamente.',
      [AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED]: 'Erro de conectividade. Tente novamente em alguns minutos.',
      
      [AUDIO_ERROR_TYPES.INVALID_CONFIGURATION]: 'Erro de configuração do serviço. Contate o suporte.',
      [AUDIO_ERROR_TYPES.MISSING_API_KEY]: 'Serviço de áudio não configurado. Contate o suporte.',
      [AUDIO_ERROR_TYPES.INVALID_API_KEY]: 'Erro de autenticação no serviço de áudio. Contate o suporte.',
      
      [AUDIO_ERROR_TYPES.UNKNOWN_ERROR]: 'Erro inesperado ao processar áudio. Tente novamente ou envie uma mensagem de texto.'
    };
  }
}

/**
 * Audio Error Handler - Centralized audio error processing and logging
 */
export class AudioErrorHandler {
  constructor() {
    this.errorStats = new Map();
    this.alertThresholds = {
      [AUDIO_ERROR_SEVERITY.CRITICAL]: 1,    // Alert immediately
      [AUDIO_ERROR_SEVERITY.HIGH]: 3,        // Alert after 3 occurrences
      [AUDIO_ERROR_SEVERITY.MEDIUM]: 5,      // Alert after 5 occurrences
      [AUDIO_ERROR_SEVERITY.LOW]: 10         // Alert after 10 occurrences
    };
    
    // Metrics for monitoring
    this.metrics = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsBySeverity: new Map(),
      retryableErrors: 0,
      userActionErrors: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Process and handle audio processing error
   * @param {Error} error - Error to process
   * @param {object} context - Additional context
   * @returns {AudioProcessingError} Processed error
   */
  handleError(error, context = {}) {
    let audioError;

    // Convert to AudioProcessingError if not already
    if (error instanceof AudioProcessingError) {
      audioError = error;
      // Merge additional context
      audioError.context = { ...audioError.context, ...context };
    } else {
      // Create AudioProcessingError from generic error
      audioError = this._convertToAudioProcessingError(error, context);
    }

    // Log error with structured data
    this._logError(audioError);

    // Update error statistics and metrics
    this._updateErrorStats(audioError);
    this._updateMetrics(audioError);

    // Check if alerting is needed
    this._checkAlertThresholds(audioError);

    return audioError;
  }

  /**
   * Convert generic error to AudioProcessingError
   * @param {Error} error - Generic error
   * @param {object} context - Error context
   * @returns {AudioProcessingError} Converted error
   */
  _convertToAudioProcessingError(error, context) {
    // Determine error type based on error characteristics
    const errorType = this._classifyError(error);
    
    // Get user-friendly message
    const userMessages = AudioProcessingError.getUserMessages();
    const userMessage = userMessages[errorType] || userMessages[AUDIO_ERROR_TYPES.UNKNOWN_ERROR];

    return new AudioProcessingError(
      userMessage,
      errorType,
      error,
      context
    );
  }

  /**
   * Classify error type based on error characteristics
   * @param {Error} error - Error to classify
   * @returns {string} Error type
   */
  _classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';

    // Network and connection errors
    if (code.includes('econnreset') || code.includes('enotfound') || 
        code.includes('econnrefused') || message.includes('network')) {
      return AUDIO_ERROR_TYPES.NETWORK_ERROR;
    }

    if (code.includes('etimedout') || message.includes('timeout')) {
      if (message.includes('download')) {
        return AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT;
      }
      if (message.includes('transcription') || message.includes('whisper')) {
        return AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT;
      }
      return AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT;
    }

    // OpenAI specific errors
    if (message.includes('openai') || message.includes('whisper')) {
      if (message.includes('rate limit') || error.status === 429) {
        return AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT;
      }
      if (message.includes('quota') || message.includes('billing')) {
        return AUDIO_ERROR_TYPES.OPENAI_QUOTA_EXCEEDED;
      }
      if (error.status === 401 || message.includes('unauthorized') || message.includes('api key')) {
        return AUDIO_ERROR_TYPES.AUTHENTICATION_FAILED;
      }
      if (error.status >= 500) {
        return AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE;
      }
      return AUDIO_ERROR_TYPES.OPENAI_API_ERROR;
    }

    // File and media errors
    if (message.includes('file too large') || message.includes('size limit')) {
      return AUDIO_ERROR_TYPES.FILE_TOO_LARGE;
    }

    if (message.includes('unsupported format') || message.includes('invalid format')) {
      return AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT;
    }

    if (message.includes('corrupted') || message.includes('invalid audio')) {
      return AUDIO_ERROR_TYPES.CORRUPTED_AUDIO;
    }

    if (message.includes('media not found') || error.status === 404) {
      return AUDIO_ERROR_TYPES.MEDIA_NOT_FOUND;
    }

    if (message.includes('access denied') || error.status === 403) {
      return AUDIO_ERROR_TYPES.MEDIA_ACCESS_DENIED;
    }

    // Download errors
    if (message.includes('download')) {
      return AUDIO_ERROR_TYPES.DOWNLOAD_FAILED;
    }

    // Transcription errors
    if (message.includes('transcription') || message.includes('empty result')) {
      if (message.includes('empty') || message.includes('no speech')) {
        return AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY;
      }
      return AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED;
    }

    // Processing errors
    if (message.includes('memory') || message.includes('out of memory')) {
      return AUDIO_ERROR_TYPES.MEMORY_LIMIT_EXCEEDED;
    }

    if (message.includes('concurrent') || message.includes('too many requests')) {
      return AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED;
    }

    // Configuration errors
    if (message.includes('api key') || message.includes('missing key')) {
      return AUDIO_ERROR_TYPES.MISSING_API_KEY;
    }

    if (message.includes('configuration') || message.includes('config')) {
      return AUDIO_ERROR_TYPES.INVALID_CONFIGURATION;
    }

    return AUDIO_ERROR_TYPES.UNKNOWN_ERROR;
  }

  /**
   * Log error with structured data for monitoring
   * @param {AudioProcessingError} error - Error to log
   */
  _logError(error) {
    const logContext = {
      errorId: error.errorId,
      errorType: error.errorType,
      severity: error.severity,
      retryable: error.retryable,
      requiresUserAction: error.requiresUserAction,
      context: error.context,
      suggestedAction: error.getSuggestedAction(),
      requiresAttention: error.requiresImmediateAttention(),
      httpStatus: error.httpStatus,
      networkCode: error.networkCode,
      service: 'AudioErrorHandler'
    };

    // Log based on severity
    switch (error.severity) {
      case AUDIO_ERROR_SEVERITY.CRITICAL:
        structuredLogger.error(`CRITICAL Audio Processing Error: ${error.technicalMessage}`, logContext);
        break;
      case AUDIO_ERROR_SEVERITY.HIGH:
        structuredLogger.error(`HIGH severity Audio Processing Error: ${error.technicalMessage}`, logContext);
        break;
      case AUDIO_ERROR_SEVERITY.MEDIUM:
        structuredLogger.warn(`MEDIUM severity Audio Processing Error: ${error.technicalMessage}`, logContext);
        break;
      case AUDIO_ERROR_SEVERITY.LOW:
        structuredLogger.info(`LOW severity Audio Processing Error: ${error.technicalMessage}`, logContext);
        break;
      default:
        structuredLogger.error(`Audio Processing Error: ${error.technicalMessage}`, logContext);
    }
  }

  /**
   * Update error statistics for monitoring
   * @param {AudioProcessingError} error - Error to track
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
   * Update metrics for monitoring and analytics
   * @param {AudioProcessingError} error - Error to track
   */
  _updateMetrics(error) {
    this.metrics.totalErrors++;
    
    // Update error type counts
    const typeCount = this.metrics.errorsByType.get(error.errorType) || 0;
    this.metrics.errorsByType.set(error.errorType, typeCount + 1);
    
    // Update severity counts
    const severityCount = this.metrics.errorsBySeverity.get(error.severity) || 0;
    this.metrics.errorsBySeverity.set(error.severity, severityCount + 1);
    
    // Update special counters
    if (error.retryable) {
      this.metrics.retryableErrors++;
    }
    
    if (error.requiresUserAction) {
      this.metrics.userActionErrors++;
    }
  }

  /**
   * Check if error frequency exceeds alert thresholds
   * @param {AudioProcessingError} error - Error to check
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
   * @param {AudioProcessingError} error - Error that triggered alert
   * @param {object} stats - Error statistics
   */
  _triggerAlert(error, stats) {
    const alertContext = {
      errorType: error.errorType,
      severity: error.severity,
      occurrenceCount: stats.count,
      threshold: this.alertThresholds[error.severity],
      suggestedAction: error.getSuggestedAction(),
      requiresImmediateAttention: error.requiresImmediateAttention(),
      errorId: error.errorId,
      service: 'AudioErrorHandler'
    };

    structuredLogger.error(`ALERT: High frequency Audio Processing error detected`, alertContext);

    // Here you could integrate with alerting systems like:
    // - Slack notifications
    // - Email alerts
    // - PagerDuty
    // - Custom webhook notifications
    // - Metrics systems (Prometheus, DataDog, etc.)
  }

  /**
   * Create error from error type with context
   * @param {string} errorType - Error type from AUDIO_ERROR_TYPES
   * @param {object} context - Error context
   * @param {Error} originalError - Original error (optional)
   * @returns {AudioProcessingError} Created error
   */
  createError(errorType, context = {}, originalError = null) {
    const userMessages = AudioProcessingError.getUserMessages();
    const userMessage = userMessages[errorType] || userMessages[AUDIO_ERROR_TYPES.UNKNOWN_ERROR];

    return new AudioProcessingError(
      userMessage,
      errorType,
      originalError,
      context
    );
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
      totalErrors: this.metrics.totalErrors,
      errorsByType: Object.fromEntries(this.metrics.errorsByType),
      errorsBySeverity: Object.fromEntries(this.metrics.errorsBySeverity),
      retryableErrors: this.metrics.retryableErrors,
      userActionErrors: this.metrics.userActionErrors,
      detailedStats: stats,
      lastReset: this.metrics.lastReset,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get error metrics for monitoring dashboards
   * @returns {object} Error metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      errorsByType: Object.fromEntries(this.metrics.errorsByType),
      errorsBySeverity: Object.fromEntries(this.metrics.errorsBySeverity),
      currentTime: new Date().toISOString()
    };
  }

  /**
   * Clear error statistics (useful for testing or periodic resets)
   */
  clearStats() {
    this.errorStats.clear();
    this.metrics = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsBySeverity: new Map(),
      retryableErrors: 0,
      userActionErrors: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Set custom alert thresholds
   * @param {object} thresholds - Custom thresholds by severity
   */
  setAlertThresholds(thresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
  }

  /**
   * Check if error type is retryable
   * @param {string} errorType - Error type to check
   * @returns {boolean} True if retryable
   */
  isRetryableError(errorType) {
    const retryableErrors = [
      AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT,
      AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT,
      AUDIO_ERROR_TYPES.NETWORK_ERROR,
      AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT,
      AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE,
      AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT,
      AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED,
      AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED
    ];

    return retryableErrors.includes(errorType);
  }

  /**
   * Get recommended retry delay for error type
   * @param {string} errorType - Error type
   * @returns {number} Delay in milliseconds
   */
  getRetryDelay(errorType) {
    const delays = {
      [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 60000,           // 1 minute
      [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 30000,        // 30 seconds
      [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 5000,               // 5 seconds
      [AUDIO_ERROR_TYPES.CONNECTION_TIMEOUT]: 3000,          // 3 seconds
      [AUDIO_ERROR_TYPES.DOWNLOAD_TIMEOUT]: 2000,            // 2 seconds
      [AUDIO_ERROR_TYPES.TRANSCRIPTION_TIMEOUT]: 5000,       // 5 seconds
      [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 3000,          // 3 seconds
      [AUDIO_ERROR_TYPES.DNS_RESOLUTION_FAILED]: 10000,      // 10 seconds
      [AUDIO_ERROR_TYPES.CONCURRENT_LIMIT_EXCEEDED]: 2000    // 2 seconds
    };

    return delays[errorType] || 1000; // Default 1 second
  }
}

// Create singleton instance
export const audioErrorHandler = new AudioErrorHandler();