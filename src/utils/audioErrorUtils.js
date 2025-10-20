import { 
  audioErrorHandler, 
  AUDIO_ERROR_TYPES, 
  AUDIO_ERROR_SEVERITY 
} from "../services/errorHandling/AudioErrorHandler.js";
import { 
  audioRetryHandler, 
  RETRY_CONFIG, 
  CIRCUIT_BREAKER_STATES 
} from "../services/errorHandling/AudioRetryHandler.js";

/**
 * Audio Error Utilities
 * Provides utility functions for audio error handling, monitoring, and debugging
 */

/**
 * Get comprehensive audio error handling status
 * @returns {object} Complete status information
 */
export function getAudioErrorStatus() {
  return {
    errorHandler: {
      stats: audioErrorHandler.getErrorStats(),
      metrics: audioErrorHandler.getMetrics()
    },
    retryHandler: {
      stats: audioRetryHandler.getRetryStats(),
      circuitBreakers: audioRetryHandler.getCircuitBreakerStatus(),
      activeRetries: audioRetryHandler.getActiveRetries()
    },
    configuration: {
      errorTypes: AUDIO_ERROR_TYPES,
      errorSeverity: AUDIO_ERROR_SEVERITY,
      retryConfig: RETRY_CONFIG,
      circuitBreakerStates: CIRCUIT_BREAKER_STATES
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Check if audio processing is healthy
 * @returns {object} Health check result
 */
export function checkAudioProcessingHealth() {
  const circuitBreakers = audioRetryHandler.getCircuitBreakerStatus();
  const errorStats = audioErrorHandler.getErrorStats();
  
  const health = {
    healthy: true,
    issues: [],
    warnings: [],
    circuitBreakers: {},
    errorRates: {}
  };

  // Check circuit breaker states
  for (const [operation, status] of Object.entries(circuitBreakers)) {
    health.circuitBreakers[operation] = status.state;
    
    if (status.state === CIRCUIT_BREAKER_STATES.OPEN) {
      health.healthy = false;
      health.issues.push(`Circuit breaker OPEN for ${operation} operation`);
    } else if (status.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      health.warnings.push(`Circuit breaker HALF_OPEN for ${operation} operation`);
    }
  }

  // Check error rates
  const totalErrors = errorStats.totalErrors || 0;
  const criticalErrors = errorStats.errorsBySeverity?.CRITICAL || 0;
  const highErrors = errorStats.errorsBySeverity?.HIGH || 0;

  if (criticalErrors > 0) {
    health.healthy = false;
    health.issues.push(`${criticalErrors} critical errors detected`);
  }

  if (highErrors > 5) {
    health.warnings.push(`${highErrors} high severity errors detected`);
  }

  health.errorRates = {
    total: totalErrors,
    critical: criticalErrors,
    high: highErrors,
    retryable: errorStats.retryableErrors || 0,
    userAction: errorStats.userActionErrors || 0
  };

  return health;
}

/**
 * Get user-friendly error message for error type
 * @param {string} errorType - Error type from AUDIO_ERROR_TYPES
 * @returns {string} User-friendly message
 */
export function getUserFriendlyMessage(errorType) {
  const messages = {
    [AUDIO_ERROR_TYPES.DOWNLOAD_FAILED]: 'Não consegui baixar seu áudio. Tente enviar novamente.',
    [AUDIO_ERROR_TYPES.FILE_TOO_LARGE]: 'Seu áudio é muito grande. Envie um áudio de até 16MB.',
    [AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT]: 'Formato de áudio não suportado. Use MP3, WAV ou OGG.',
    [AUDIO_ERROR_TYPES.TRANSCRIPTION_FAILED]: 'Não consegui entender seu áudio. Tente falar mais claramente ou envie uma mensagem de texto.',
    [AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE]: 'Serviço de áudio temporariamente indisponível. Tente novamente em alguns minutos.',
    [AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT]: 'Processamento do áudio demorou muito. Tente com um áudio mais curto.',
    [AUDIO_ERROR_TYPES.NETWORK_ERROR]: 'Erro de conexão ao processar áudio. Tente novamente.',
    [AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY]: 'Seu áudio está muito baixo ou sem fala. Tente gravar novamente.',
    [AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY]: 'Qualidade do áudio muito baixa. Tente gravar em um local mais silencioso.',
    [AUDIO_ERROR_TYPES.OPENAI_RATE_LIMIT]: 'Muitas solicitações de áudio. Aguarde um momento e tente novamente.',
    [AUDIO_ERROR_TYPES.UNKNOWN_ERROR]: 'Erro inesperado ao processar áudio. Tente novamente ou envie uma mensagem de texto.'
  };

  return messages[errorType] || messages[AUDIO_ERROR_TYPES.UNKNOWN_ERROR];
}

/**
 * Check if error type is retryable
 * @param {string} errorType - Error type to check
 * @returns {boolean} True if retryable
 */
export function isRetryableError(errorType) {
  return audioErrorHandler.isRetryableError(errorType);
}

/**
 * Get recommended retry delay for error type
 * @param {string} errorType - Error type
 * @returns {number} Delay in milliseconds
 */
export function getRetryDelay(errorType) {
  return audioErrorHandler.getRetryDelay(errorType);
}

/**
 * Reset circuit breakers (for manual recovery)
 * @param {string} operationType - Optional operation type to reset, or null for all
 */
export function resetCircuitBreakers(operationType = null) {
  if (operationType) {
    audioRetryHandler.resetCircuitBreaker(operationType);
  } else {
    audioRetryHandler.resetAllCircuitBreakers();
  }
}

/**
 * Clear error statistics (for testing or periodic cleanup)
 */
export function clearErrorStats() {
  audioErrorHandler.clearStats();
  audioRetryHandler.clearStats();
}

/**
 * Get error type classification for debugging
 * @param {Error} error - Error to classify
 * @returns {object} Classification information
 */
export function classifyError(error) {
  const audioError = audioErrorHandler.handleError(error);
  
  return {
    errorType: audioError.errorType,
    severity: audioError.severity,
    retryable: audioError.retryable,
    requiresUserAction: audioError.requiresUserAction,
    userMessage: audioError.userMessage,
    technicalMessage: audioError.technicalMessage,
    suggestedAction: audioError.getSuggestedAction(),
    retryDelay: audioError.getRetryDelay()
  };
}

/**
 * Export error types and constants for external use
 */
export {
  AUDIO_ERROR_TYPES,
  AUDIO_ERROR_SEVERITY,
  RETRY_CONFIG,
  CIRCUIT_BREAKER_STATES
};