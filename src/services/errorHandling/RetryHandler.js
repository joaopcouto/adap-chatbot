import { structuredLogger } from "../../helpers/logger.js";
import { CloudApiError, ERROR_TYPES, ERROR_SEVERITY } from "./CloudApiErrorHandler.js";

/**
 * Circuit Breaker States
 */
export const CIRCUIT_BREAKER_STATES = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Circuit is open, failing fast
  HALF_OPEN: 'HALF_OPEN'  // Testing if service is back
};

/**
 * Retry Strategy Types
 */
export const RETRY_STRATEGIES = {
  EXPONENTIAL_BACKOFF: 'EXPONENTIAL_BACKOFF',
  LINEAR_BACKOFF: 'LINEAR_BACKOFF',
  FIXED_DELAY: 'FIXED_DELAY',
  IMMEDIATE: 'IMMEDIATE'
};

/**
 * Advanced Retry Handler with exponential backoff and circuit breaker
 */
export class RetryHandler {
  constructor(config = {}) {
    // Retry configuration
    this.maxRetries = config.maxRetries || 3;
    this.baseDelayMs = config.baseDelayMs || 1000;
    this.maxDelayMs = config.maxDelayMs || 30000;
    this.backoffMultiplier = config.backoffMultiplier || 2;
    this.jitterFactor = config.jitterFactor || 0.1;
    this.strategy = config.strategy || RETRY_STRATEGIES.EXPONENTIAL_BACKOFF;
    
    // Circuit breaker configuration
    this.circuitBreakerEnabled = config.circuitBreakerEnabled !== false;
    this.failureThreshold = config.failureThreshold || 5;
    this.recoveryTimeoutMs = config.recoveryTimeoutMs || 60000;
    this.successThreshold = config.successThreshold || 2;
    
    // Circuit breaker state
    this.circuitState = CIRCUIT_BREAKER_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    // Statistics
    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      circuitBreakerTrips: 0,
      averageRetryCount: 0
    };

    structuredLogger.info("RetryHandler initialized", {
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      strategy: this.strategy,
      circuitBreakerEnabled: this.circuitBreakerEnabled,
      failureThreshold: this.failureThreshold
    });
  }

  /**
   * Execute operation with retry logic and circuit breaker
   * @param {Function} operation - Async operation to execute
   * @param {object} context - Operation context for logging
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry(operation, context = {}) {
    const operationId = this._generateOperationId();
    const startTime = Date.now();
    
    structuredLogger.debug("Starting retry operation", {
      operationId,
      context,
      circuitState: this.circuitState,
      failureCount: this.failureCount
    });

    // Check circuit breaker
    if (this.circuitBreakerEnabled && !this._canExecute()) {
      const error = new CloudApiError(
        "Circuit breaker is OPEN - failing fast",
        null,
        "CIRCUIT_BREAKER_OPEN",
        null,
        null,
        { ...context, operationId, circuitState: this.circuitState }
      );
      
      structuredLogger.warn("Circuit breaker prevented execution", {
        operationId,
        circuitState: this.circuitState,
        failureCount: this.failureCount,
        nextAttemptTime: this.nextAttemptTime
      });
      
      throw error;
    }

    let lastError;
    let attempt = 0;
    const maxAttempts = this.maxRetries + 1; // +1 for initial attempt

    while (attempt < maxAttempts) {
      attempt++;
      this.stats.totalAttempts++;
      
      const attemptStartTime = Date.now();
      
      try {
        structuredLogger.debug("Executing operation attempt", {
          operationId,
          attempt,
          maxAttempts,
          context
        });

        const result = await operation();
        
        const attemptDuration = Date.now() - attemptStartTime;
        const totalDuration = Date.now() - startTime;
        
        // Success - update circuit breaker and stats
        this._onSuccess();
        this.stats.totalSuccesses++;
        
        if (attempt > 1) {
          this.stats.totalRetries += (attempt - 1);
          this._updateAverageRetryCount();
        }

        structuredLogger.info("Operation succeeded", {
          operationId,
          attempt,
          totalAttempts: attempt,
          attemptDuration,
          totalDuration,
          context,
          circuitState: this.circuitState
        });

        return result;
        
      } catch (error) {
        lastError = error;
        const attemptDuration = Date.now() - attemptStartTime;
        
        // Convert to CloudApiError if needed
        const cloudApiError = error instanceof CloudApiError 
          ? error 
          : this._convertToCloudApiError(error, context);

        structuredLogger.warn("Operation attempt failed", {
          operationId,
          attempt,
          maxAttempts,
          attemptDuration,
          error: cloudApiError.message,
          errorType: cloudApiError.errorType,
          retryable: cloudApiError.retryable,
          context
        });

        // Check if we should retry
        if (attempt >= maxAttempts || !this._shouldRetry(cloudApiError, attempt)) {
          // Final failure - update circuit breaker and stats
          this._onFailure();
          this.stats.totalFailures++;
          
          const totalDuration = Date.now() - startTime;
          
          structuredLogger.error("Operation failed after all retries", {
            operationId,
            totalAttempts: attempt,
            totalDuration,
            finalError: cloudApiError.message,
            errorType: cloudApiError.errorType,
            circuitState: this.circuitState,
            context
          });

          throw cloudApiError;
        }

        // Calculate delay for next attempt
        const delay = this._calculateDelay(attempt, cloudApiError);
        
        structuredLogger.info("Retrying operation after delay", {
          operationId,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: delay,
          errorType: cloudApiError.errorType,
          context
        });

        await this._sleep(delay);
      }
    }

    // This should never be reached, but just in case
    throw lastError;
  }

  /**
   * Check if circuit breaker allows execution
   * @returns {boolean} True if execution is allowed
   */
  _canExecute() {
    const now = Date.now();

    switch (this.circuitState) {
      case CIRCUIT_BREAKER_STATES.CLOSED:
        return true;
        
      case CIRCUIT_BREAKER_STATES.OPEN:
        if (now >= this.nextAttemptTime) {
          // Transition to half-open
          this.circuitState = CIRCUIT_BREAKER_STATES.HALF_OPEN;
          this.successCount = 0;
          
          structuredLogger.info("Circuit breaker transitioning to HALF_OPEN", {
            circuitState: this.circuitState,
            failureCount: this.failureCount,
            recoveryTimeoutMs: this.recoveryTimeoutMs
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
   * Handle successful operation
   */
  _onSuccess() {
    if (!this.circuitBreakerEnabled) return;

    switch (this.circuitState) {
      case CIRCUIT_BREAKER_STATES.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        break;
        
      case CIRCUIT_BREAKER_STATES.HALF_OPEN:
        this.successCount++;
        
        if (this.successCount >= this.successThreshold) {
          // Transition back to closed
          this.circuitState = CIRCUIT_BREAKER_STATES.CLOSED;
          this.failureCount = 0;
          this.successCount = 0;
          this.lastFailureTime = null;
          this.nextAttemptTime = null;
          
          structuredLogger.info("Circuit breaker recovered - transitioning to CLOSED", {
            circuitState: this.circuitState,
            successCount: this.successCount,
            successThreshold: this.successThreshold
          });
        }
        break;
    }
  }

  /**
   * Handle failed operation
   */
  _onFailure() {
    if (!this.circuitBreakerEnabled) return;

    this.failureCount++;
    this.lastFailureTime = Date.now();

    switch (this.circuitState) {
      case CIRCUIT_BREAKER_STATES.CLOSED:
        if (this.failureCount >= this.failureThreshold) {
          // Trip circuit breaker
          this.circuitState = CIRCUIT_BREAKER_STATES.OPEN;
          this.nextAttemptTime = this.lastFailureTime + this.recoveryTimeoutMs;
          this.stats.circuitBreakerTrips++;
          
          structuredLogger.error("Circuit breaker tripped - transitioning to OPEN", {
            circuitState: this.circuitState,
            failureCount: this.failureCount,
            failureThreshold: this.failureThreshold,
            nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
          });
        }
        break;
        
      case CIRCUIT_BREAKER_STATES.HALF_OPEN:
        // Failure in half-open state - go back to open
        this.circuitState = CIRCUIT_BREAKER_STATES.OPEN;
        this.nextAttemptTime = this.lastFailureTime + this.recoveryTimeoutMs;
        this.successCount = 0;
        this.stats.circuitBreakerTrips++;
        
        structuredLogger.warn("Circuit breaker failed in HALF_OPEN - returning to OPEN", {
          circuitState: this.circuitState,
          failureCount: this.failureCount,
          nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
        });
        break;
    }
  }

  /**
   * Determine if error should be retried
   * @param {CloudApiError} error - Error to check
   * @param {number} attempt - Current attempt number
   * @returns {boolean} True if should retry
   */
  _shouldRetry(error, attempt) {
    // Don't retry if not retryable
    if (!error.retryable) {
      return false;
    }

    // Don't retry critical errors immediately
    if (error.severity === ERROR_SEVERITY.CRITICAL) {
      return false;
    }

    // Special handling for specific error types
    switch (error.errorType) {
      case ERROR_TYPES.RATE_LIMIT_EXCEEDED:
      case ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED:
      case ERROR_TYPES.TEMPLATE_LIMIT_EXCEEDED:
        // Always retry rate limit errors (with appropriate delay)
        return true;
        
      case ERROR_TYPES.AUTHENTICATION_FAILED:
      case ERROR_TYPES.INVALID_ACCESS_TOKEN:
      case ERROR_TYPES.INSUFFICIENT_PERMISSIONS:
        // Don't retry auth errors
        return false;
        
      case ERROR_TYPES.INVALID_PHONE_NUMBER:
      case ERROR_TYPES.INVALID_MESSAGE_FORMAT:
      case ERROR_TYPES.TEMPLATE_NOT_FOUND:
        // Don't retry validation errors
        return false;
        
      default:
        return true;
    }
  }

  /**
   * Calculate delay for retry attempt
   * @param {number} attempt - Current attempt number
   * @param {CloudApiError} error - Error that occurred
   * @returns {number} Delay in milliseconds
   */
  _calculateDelay(attempt, error) {
    let delay;

    // Use error-specific delay if available
    if (error && typeof error.getRetryDelay === 'function') {
      const errorDelay = error.getRetryDelay();
      if (errorDelay > 0) {
        return this._addJitter(errorDelay);
      }
    }

    // Calculate delay based on strategy
    switch (this.strategy) {
      case RETRY_STRATEGIES.EXPONENTIAL_BACKOFF:
        delay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
        break;
        
      case RETRY_STRATEGIES.LINEAR_BACKOFF:
        delay = this.baseDelayMs * attempt;
        break;
        
      case RETRY_STRATEGIES.FIXED_DELAY:
        delay = this.baseDelayMs;
        break;
        
      case RETRY_STRATEGIES.IMMEDIATE:
        delay = 0;
        break;
        
      default:
        delay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
    }

    // Cap at maximum delay
    delay = Math.min(delay, this.maxDelayMs);

    // Add jitter to prevent thundering herd
    return this._addJitter(delay);
  }

  /**
   * Add jitter to delay to prevent thundering herd
   * @param {number} delay - Base delay
   * @returns {number} Delay with jitter
   */
  _addJitter(delay) {
    if (this.jitterFactor <= 0) {
      return delay;
    }

    const jitter = delay * this.jitterFactor * Math.random();
    return Math.floor(delay + jitter);
  }

  /**
   * Convert generic error to CloudApiError
   * @param {Error} error - Generic error
   * @param {object} context - Error context
   * @returns {CloudApiError} Converted error
   */
  _convertToCloudApiError(error, context) {
    return new CloudApiError(
      error.message,
      error.status || null,
      error.code || null,
      null,
      null,
      context
    );
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
   * @returns {string} Operation ID
   */
  _generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Update average retry count statistic
   */
  _updateAverageRetryCount() {
    if (this.stats.totalSuccesses > 0) {
      this.stats.averageRetryCount = this.stats.totalRetries / this.stats.totalSuccesses;
    }
  }

  /**
   * Get retry handler statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      configuration: {
        maxRetries: this.maxRetries,
        baseDelayMs: this.baseDelayMs,
        maxDelayMs: this.maxDelayMs,
        strategy: this.strategy,
        circuitBreakerEnabled: this.circuitBreakerEnabled,
        failureThreshold: this.failureThreshold,
        recoveryTimeoutMs: this.recoveryTimeoutMs
      }
    };
  }

  /**
   * Reset circuit breaker state (useful for testing or manual recovery)
   */
  resetCircuitBreaker() {
    this.circuitState = CIRCUIT_BREAKER_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    structuredLogger.info("Circuit breaker manually reset", {
      circuitState: this.circuitState
    });
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalAttempts: 0,
      totalRetries: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      circuitBreakerTrips: 0,
      averageRetryCount: 0
    };
  }

  /**
   * Update configuration
   * @param {object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    const oldConfig = {
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      strategy: this.strategy,
      circuitBreakerEnabled: this.circuitBreakerEnabled,
      failureThreshold: this.failureThreshold
    };

    // Update configuration
    if (newConfig.maxRetries !== undefined) this.maxRetries = newConfig.maxRetries;
    if (newConfig.baseDelayMs !== undefined) this.baseDelayMs = newConfig.baseDelayMs;
    if (newConfig.maxDelayMs !== undefined) this.maxDelayMs = newConfig.maxDelayMs;
    if (newConfig.backoffMultiplier !== undefined) this.backoffMultiplier = newConfig.backoffMultiplier;
    if (newConfig.jitterFactor !== undefined) this.jitterFactor = newConfig.jitterFactor;
    if (newConfig.strategy !== undefined) this.strategy = newConfig.strategy;
    if (newConfig.circuitBreakerEnabled !== undefined) this.circuitBreakerEnabled = newConfig.circuitBreakerEnabled;
    if (newConfig.failureThreshold !== undefined) this.failureThreshold = newConfig.failureThreshold;
    if (newConfig.recoveryTimeoutMs !== undefined) this.recoveryTimeoutMs = newConfig.recoveryTimeoutMs;
    if (newConfig.successThreshold !== undefined) this.successThreshold = newConfig.successThreshold;

    structuredLogger.info("RetryHandler configuration updated", {
      oldConfig,
      newConfig: {
        maxRetries: this.maxRetries,
        baseDelayMs: this.baseDelayMs,
        maxDelayMs: this.maxDelayMs,
        strategy: this.strategy,
        circuitBreakerEnabled: this.circuitBreakerEnabled,
        failureThreshold: this.failureThreshold
      }
    });
  }

  /**
   * Check if circuit breaker is healthy
   * @returns {boolean} True if healthy
   */
  isHealthy() {
    return this.circuitState === CIRCUIT_BREAKER_STATES.CLOSED;
  }

  /**
   * Get health status
   * @returns {object} Health status
   */
  getHealthStatus() {
    return {
      healthy: this.isHealthy(),
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      stats: this.stats,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null
    };
  }
}

/**
 * Factory function to create RetryHandler with common configurations
 */
export class RetryHandlerFactory {
  /**
   * Create retry handler for Cloud API operations
   * @param {object} customConfig - Custom configuration overrides
   * @returns {RetryHandler} Configured retry handler
   */
  static createForCloudApi(customConfig = {}) {
    const defaultConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
      circuitBreakerEnabled: true,
      failureThreshold: 5,
      recoveryTimeoutMs: 60000,
      successThreshold: 2
    };

    return new RetryHandler({ ...defaultConfig, ...customConfig });
  }

  /**
   * Create retry handler for rate-limited operations
   * @param {object} customConfig - Custom configuration overrides
   * @returns {RetryHandler} Configured retry handler
   */
  static createForRateLimited(customConfig = {}) {
    const defaultConfig = {
      maxRetries: 5,
      baseDelayMs: 5000,
      maxDelayMs: 300000, // 5 minutes
      backoffMultiplier: 1.5,
      jitterFactor: 0.2,
      strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
      circuitBreakerEnabled: false, // Don't use circuit breaker for rate limits
      failureThreshold: 10,
      recoveryTimeoutMs: 300000
    };

    return new RetryHandler({ ...defaultConfig, ...customConfig });
  }

  /**
   * Create retry handler for critical operations
   * @param {object} customConfig - Custom configuration overrides
   * @returns {RetryHandler} Configured retry handler
   */
  static createForCritical(customConfig = {}) {
    const defaultConfig = {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      jitterFactor: 0.05,
      strategy: RETRY_STRATEGIES.EXPONENTIAL_BACKOFF,
      circuitBreakerEnabled: true,
      failureThreshold: 3,
      recoveryTimeoutMs: 30000,
      successThreshold: 3
    };

    return new RetryHandler({ ...defaultConfig, ...customConfig });
  }
}

export default RetryHandler;