import { structuredLogger } from "../../helpers/logger.js";
import { 
  AudioProcessingError, 
  audioErrorHandler, 
  AUDIO_ERROR_TYPES, 
  AUDIO_ERROR_SEVERITY 
} from "./AudioErrorHandler.js";

/**
 * Retry Configuration for different operation types
 */
const RETRY_CONFIG = {
  download: {
    maxAttempts: 3,
    baseDelay: 1000,      // 1 second
    maxDelay: 10000,      // 10 seconds
    backoffMultiplier: 2,
    jitterMax: 500        // Random jitter up to 500ms
  },
  transcription: {
    maxAttempts: 2,       // Fewer retries for expensive operations
    baseDelay: 2000,      // 2 seconds
    maxDelay: 30000,      // 30 seconds
    backoffMultiplier: 3,
    jitterMax: 1000       // Random jitter up to 1 second
  },
  validation: {
    maxAttempts: 2,
    baseDelay: 500,       // 500ms
    maxDelay: 2000,       // 2 seconds
    backoffMultiplier: 2,
    jitterMax: 200        // Random jitter up to 200ms
  }
};

/**
 * Circuit Breaker States
 */
const CIRCUIT_BREAKER_STATES = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Circuit is open, failing fast
  HALF_OPEN: 'HALF_OPEN'  // Testing if service is back
};

/**
 * Circuit Breaker Configuration
 */
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,        // Number of failures before opening
  recoveryTimeout: 60000,     // 1 minute before trying half-open
  successThreshold: 2,        // Successes needed to close from half-open
  monitoringWindow: 300000    // 5 minutes monitoring window
};

/**
 * Audio Retry Handler with exponential backoff and circuit breaker
 */
export class AudioRetryHandler {
  constructor() {
    this.circuitBreakers = new Map(); // Per-operation circuit breakers
    this.retryStats = new Map();      // Retry statistics
    this.activeRetries = new Map();   // Track active retry operations
    
    // Initialize circuit breakers for each operation type
    Object.keys(RETRY_CONFIG).forEach(operation => {
      this.circuitBreakers.set(operation, {
        state: CIRCUIT_BREAKER_STATES.CLOSED,
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        nextAttemptTime: null
      });
    });
  }

  /**
   * Execute operation with retry logic and circuit breaker
   * @param {Function} operation - Async operation to execute
   * @param {string} operationType - Type of operation (download, transcription, validation)
   * @param {object} context - Operation context for logging
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry(operation, operationType, context = {}) {
    const config = RETRY_CONFIG[operationType];
    if (!config) {
      throw new Error(`Unknown operation type: ${operationType}`);
    }

    const circuitBreaker = this.circuitBreakers.get(operationType);
    const operationId = this._generateOperationId(operationType, context);

    // Check circuit breaker state
    if (!this._canExecute(circuitBreaker, operationType)) {
      const error = audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.SERVICE_UNAVAILABLE,
        { 
          ...context, 
          operationType, 
          circuitBreakerState: circuitBreaker.state,
          reason: 'circuit_breaker_open'
        }
      );
      throw error;
    }

    let lastError = null;
    let attempt = 0;

    // Track active retry operation
    this.activeRetries.set(operationId, {
      operationType,
      startTime: Date.now(),
      attempts: 0,
      context
    });

    try {
      while (attempt < config.maxAttempts) {
        attempt++;
        
        const attemptContext = {
          ...context,
          operationType,
          attempt,
          maxAttempts: config.maxAttempts,
          operationId
        };

        const startTime = Date.now();
        
        try {
          structuredLogger.info(`Executing ${operationType} operation`, attemptContext);
          
          const result = await operation();
          const duration = Date.now() - startTime;

          // Success - update circuit breaker and stats
          this._recordSuccess(circuitBreaker, operationType, duration);
          this._updateRetryStats(operationType, attempt, true, duration);

          structuredLogger.info(`${operationType} operation succeeded`, {
            ...attemptContext,
            duration,
            finalAttempt: attempt
          });

          return result;

        } catch (error) {
          lastError = error;
          const duration = Date.now() - startTime;

          // Check if error is retryable
          const audioError = error instanceof AudioProcessingError ? 
            error : audioErrorHandler.handleError(error, attemptContext);

          if (!audioError.retryable || attempt >= config.maxAttempts) {
            // Non-retryable error or max attempts reached
            this._recordFailure(circuitBreaker, operationType, audioError);
            this._updateRetryStats(operationType, attempt, false, duration);

            structuredLogger.error(`${operationType} operation failed permanently`, {
              ...attemptContext,
              error: audioError.technicalMessage,
              errorType: audioError.errorType,
              retryable: audioError.retryable,
              duration
            });

            throw audioError;
          }

          // Calculate delay for next attempt
          const delay = this._calculateDelay(config, attempt);

          structuredLogger.warn(`${operationType} operation failed, retrying`, {
            ...attemptContext,
            error: audioError.technicalMessage,
            errorType: audioError.errorType,
            nextAttemptIn: delay,
            duration
          });

          // Wait before next attempt
          await this._sleep(delay);
        }
      }

      // All attempts exhausted
      this._recordFailure(circuitBreaker, operationType, lastError);
      this._updateRetryStats(operationType, attempt, false);

      throw lastError || audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.UNKNOWN_ERROR,
        { ...context, operationType, attempts: attempt }
      );

    } finally {
      // Clean up active retry tracking
      this.activeRetries.delete(operationId);
    }
  }

  /**
   * Check if operation can be executed based on circuit breaker state
   * @param {object} circuitBreaker - Circuit breaker state
   * @param {string} operationType - Operation type
   * @returns {boolean} True if operation can be executed
   */
  _canExecute(circuitBreaker, operationType) {
    const now = Date.now();

    switch (circuitBreaker.state) {
      case CIRCUIT_BREAKER_STATES.CLOSED:
        return true;

      case CIRCUIT_BREAKER_STATES.OPEN:
        // Check if recovery timeout has passed
        if (circuitBreaker.nextAttemptTime && now >= circuitBreaker.nextAttemptTime) {
          circuitBreaker.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
          circuitBreaker.successes = 0;
          
          structuredLogger.info(`Circuit breaker transitioning to HALF_OPEN`, {
            operationType,
            previousState: CIRCUIT_BREAKER_STATES.OPEN,
            service: 'AudioRetryHandler'
          });
          
          return true;
        }
        return false;

      case CIRCUIT_BREAKER_STATES.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Record successful operation
   * @param {object} circuitBreaker - Circuit breaker state
   * @param {string} operationType - Operation type
   * @param {number} duration - Operation duration
   */
  _recordSuccess(circuitBreaker, operationType, duration) {
    const now = Date.now();
    circuitBreaker.lastSuccessTime = now;

    if (circuitBreaker.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      circuitBreaker.successes++;
      
      if (circuitBreaker.successes >= CIRCUIT_BREAKER_CONFIG.successThreshold) {
        circuitBreaker.state = CIRCUIT_BREAKER_STATES.CLOSED;
        circuitBreaker.failures = 0;
        circuitBreaker.successes = 0;
        
        structuredLogger.info(`Circuit breaker closed after successful recovery`, {
          operationType,
          successCount: circuitBreaker.successes,
          service: 'AudioRetryHandler'
        });
      }
    } else if (circuitBreaker.state === CIRCUIT_BREAKER_STATES.CLOSED) {
      // Reset failure count on success
      circuitBreaker.failures = 0;
    }
  }

  /**
   * Record failed operation
   * @param {object} circuitBreaker - Circuit breaker state
   * @param {string} operationType - Operation type
   * @param {Error} error - Error that occurred
   */
  _recordFailure(circuitBreaker, operationType, error) {
    const now = Date.now();
    circuitBreaker.lastFailureTime = now;
    circuitBreaker.failures++;

    // Only count certain errors towards circuit breaker
    const shouldCountFailure = this._shouldCountForCircuitBreaker(error);
    
    if (!shouldCountFailure) {
      return;
    }

    if (circuitBreaker.state === CIRCUIT_BREAKER_STATES.CLOSED) {
      if (circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        circuitBreaker.state = CIRCUIT_BREAKER_STATES.OPEN;
        circuitBreaker.nextAttemptTime = now + CIRCUIT_BREAKER_CONFIG.recoveryTimeout;
        
        structuredLogger.error(`Circuit breaker opened due to failures`, {
          operationType,
          failureCount: circuitBreaker.failures,
          threshold: CIRCUIT_BREAKER_CONFIG.failureThreshold,
          nextAttemptTime: new Date(circuitBreaker.nextAttemptTime).toISOString(),
          service: 'AudioRetryHandler'
        });
      }
    } else if (circuitBreaker.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      // Failure in half-open state - go back to open
      circuitBreaker.state = CIRCUIT_BREAKER_STATES.OPEN;
      circuitBreaker.nextAttemptTime = now + CIRCUIT_BREAKER_CONFIG.recoveryTimeout;
      circuitBreaker.successes = 0;
      
      structuredLogger.warn(`Circuit breaker reopened after failure in HALF_OPEN state`, {
        operationType,
        nextAttemptTime: new Date(circuitBreaker.nextAttemptTime).toISOString(),
        service: 'AudioRetryHandler'
      });
    }
  }

  /**
   * Determine if error should count towards circuit breaker failures
   * @param {Error} error - Error to evaluate
   * @returns {boolean} True if should count
   */
  _shouldCountForCircuitBreaker(error) {
    if (!(error instanceof AudioProcessingError)) {
      return true; // Count unknown errors
    }

    // Don't count user errors or validation errors
    const nonCountingErrors = [
      AUDIO_ERROR_TYPES.FILE_TOO_LARGE,
      AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT,
      AUDIO_ERROR_TYPES.AUDIO_TOO_SHORT,
      AUDIO_ERROR_TYPES.AUDIO_TOO_LONG,
      AUDIO_ERROR_TYPES.CORRUPTED_AUDIO,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY,
      AUDIO_ERROR_TYPES.TRANSCRIPTION_TOO_SHORT,
      AUDIO_ERROR_TYPES.POOR_AUDIO_QUALITY,
      AUDIO_ERROR_TYPES.INVALID_MEDIA_ID,
      AUDIO_ERROR_TYPES.MEDIA_NOT_FOUND
    ];

    return !nonCountingErrors.includes(error.errorType);
  }

  /**
   * Calculate delay for next retry attempt with exponential backoff and jitter
   * @param {object} config - Retry configuration
   * @param {number} attempt - Current attempt number
   * @returns {number} Delay in milliseconds
   */
  _calculateDelay(config, attempt) {
    // Exponential backoff: baseDelay * (backoffMultiplier ^ (attempt - 1))
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    
    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
    
    // Add random jitter to prevent thundering herd
    const jitter = Math.random() * config.jitterMax;
    
    return cappedDelay + jitter;
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate unique operation ID for tracking
   * @param {string} operationType - Type of operation
   * @param {object} context - Operation context
   * @returns {string} Operation ID
   */
  _generateOperationId(operationType, context) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const contextId = context.requestId || context.audioId || 'unknown';
    return `${operationType}_${contextId}_${timestamp}_${random}`;
  }

  /**
   * Update retry statistics for monitoring
   * @param {string} operationType - Operation type
   * @param {number} attempts - Number of attempts made
   * @param {boolean} success - Whether operation succeeded
   * @param {number} duration - Operation duration
   */
  _updateRetryStats(operationType, attempts, success, duration = 0) {
    const key = operationType;
    const current = this.retryStats.get(key) || {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalAttempts: 0,
      totalDuration: 0,
      averageAttempts: 0,
      averageDuration: 0,
      lastUpdated: null
    };

    current.totalOperations++;
    current.totalAttempts += attempts;
    current.totalDuration += duration;

    if (success) {
      current.successfulOperations++;
    } else {
      current.failedOperations++;
    }

    current.averageAttempts = current.totalAttempts / current.totalOperations;
    current.averageDuration = current.totalDuration / current.totalOperations;
    current.lastUpdated = new Date().toISOString();

    this.retryStats.set(key, current);
  }

  /**
   * Get circuit breaker status for all operations
   * @returns {object} Circuit breaker status
   */
  getCircuitBreakerStatus() {
    const status = {};
    
    for (const [operationType, breaker] of this.circuitBreakers.entries()) {
      status[operationType] = {
        state: breaker.state,
        failures: breaker.failures,
        successes: breaker.successes,
        lastFailureTime: breaker.lastFailureTime ? new Date(breaker.lastFailureTime).toISOString() : null,
        lastSuccessTime: breaker.lastSuccessTime ? new Date(breaker.lastSuccessTime).toISOString() : null,
        nextAttemptTime: breaker.nextAttemptTime ? new Date(breaker.nextAttemptTime).toISOString() : null,
        canExecute: this._canExecute(breaker, operationType)
      };
    }

    return status;
  }

  /**
   * Get retry statistics for monitoring
   * @returns {object} Retry statistics
   */
  getRetryStats() {
    const stats = {};
    
    for (const [operationType, stat] of this.retryStats.entries()) {
      stats[operationType] = { ...stat };
    }

    return {
      operationStats: stats,
      activeRetries: this.activeRetries.size,
      circuitBreakerStatus: this.getCircuitBreakerStatus(),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Reset circuit breaker for specific operation (for testing or manual recovery)
   * @param {string} operationType - Operation type to reset
   */
  resetCircuitBreaker(operationType) {
    const breaker = this.circuitBreakers.get(operationType);
    if (breaker) {
      breaker.state = CIRCUIT_BREAKER_STATES.CLOSED;
      breaker.failures = 0;
      breaker.successes = 0;
      breaker.lastFailureTime = null;
      breaker.nextAttemptTime = null;
      
      structuredLogger.info(`Circuit breaker manually reset`, {
        operationType,
        service: 'AudioRetryHandler'
      });
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers() {
    for (const operationType of this.circuitBreakers.keys()) {
      this.resetCircuitBreaker(operationType);
    }
  }

  /**
   * Clear retry statistics
   */
  clearStats() {
    this.retryStats.clear();
    this.activeRetries.clear();
  }

  /**
   * Get active retry operations
   * @returns {Array} Active retry operations
   */
  getActiveRetries() {
    const active = [];
    
    for (const [operationId, operation] of this.activeRetries.entries()) {
      active.push({
        operationId,
        operationType: operation.operationType,
        startTime: new Date(operation.startTime).toISOString(),
        duration: Date.now() - operation.startTime,
        attempts: operation.attempts,
        context: operation.context
      });
    }

    return active;
  }
}

// Create singleton instance
export const audioRetryHandler = new AudioRetryHandler();

// Export configuration and states for external use
export { RETRY_CONFIG, CIRCUIT_BREAKER_STATES, CIRCUIT_BREAKER_CONFIG };