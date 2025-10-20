import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the logger
const mockStructuredLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../../src/helpers/logger.js', () => ({
  structuredLogger: mockStructuredLogger
}));

// Import after mocking
import { 
  RetryHandler, 
  RetryHandlerFactory,
  CIRCUIT_BREAKER_STATES,
  RETRY_STRATEGIES 
} from '../../../src/services/errorHandling/RetryHandler.js';
import { CloudApiError, ERROR_TYPES, ERROR_SEVERITY } from '../../../src/services/errorHandling/CloudApiErrorHandler.js';

describe('RetryHandler', () => {
  let retryHandler;

  beforeEach(() => {
    retryHandler = new RetryHandler({
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterFactor: 0,
      circuitBreakerEnabled: true,
      failureThreshold: 2,
      recoveryTimeoutMs: 1000
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    retryHandler.resetStats();
    retryHandler.resetCircuitBreaker();
  });

  describe('Basic Retry Logic', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      
      const stats = retryHandler.getStats();
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.totalRetries).toBe(0);
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new CloudApiError('Server error', 500);
      const operation = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      
      const stats = retryHandler.getStats();
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.totalRetries).toBe(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new CloudApiError('Invalid phone', 400, 1);
      const operation = jest.fn().mockRejectedValue(nonRetryableError);
      
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow('Invalid phone');
      expect(operation).toHaveBeenCalledTimes(1);
      
      const stats = retryHandler.getStats();
      expect(stats.totalFailures).toBe(1);
      expect(stats.totalRetries).toBe(0);
    });

    it('should fail after max retries', async () => {
      const retryableError = new CloudApiError('Server error', 500);
      const operation = jest.fn().mockRejectedValue(retryableError);
      
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow('Server error');
      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      
      const stats = retryHandler.getStats();
      expect(stats.totalFailures).toBe(1);
      expect(stats.totalRetries).toBe(3);
    });
  });

  describe('Circuit Breaker', () => {
    it('should start in CLOSED state', () => {
      expect(retryHandler.circuitState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(retryHandler.isHealthy()).toBe(true);
    });

    it('should trip to OPEN after failure threshold', async () => {
      const error = new CloudApiError('Server error', 500);
      const operation = jest.fn().mockRejectedValue(error);

      // First failure
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow();
      expect(retryHandler.circuitState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);

      // Second failure - should trip circuit breaker
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow();
      expect(retryHandler.circuitState).toBe(CIRCUIT_BREAKER_STATES.OPEN);
      expect(retryHandler.isHealthy()).toBe(false);
    });

    it('should fail fast when circuit is OPEN', async () => {
      // Trip the circuit breaker
      const error = new CloudApiError('Server error', 500);
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow();
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow();
      
      expect(retryHandler.circuitState).toBe(CIRCUIT_BREAKER_STATES.OPEN);
      
      // Now it should fail fast
      const fastOperation = jest.fn().mockResolvedValue('success');
      await expect(retryHandler.executeWithRetry(fastOperation)).rejects.toThrow('Circuit breaker is OPEN');
      expect(fastOperation).not.toHaveBeenCalled();
    });
  });

  describe('Error Type Handling', () => {
    it('should not retry authentication errors', async () => {
      const authError = new CloudApiError('Auth failed', 401);
      const operation = jest.fn().mockRejectedValue(authError);
      
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow('Auth failed');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should always retry rate limit errors', async () => {
      const rateLimitError = new CloudApiError('Rate limit', 429);
      const operation = jest.fn().mockRejectedValue(rateLimitError);
      
      await expect(retryHandler.executeWithRetry(operation)).rejects.toThrow('Rate limit');
      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });
});

describe('RetryHandlerFactory', () => {
  it('should create handler for Cloud API with appropriate defaults', () => {
    const handler = RetryHandlerFactory.createForCloudApi();
    
    expect(handler.maxRetries).toBe(3);
    expect(handler.strategy).toBe(RETRY_STRATEGIES.EXPONENTIAL_BACKOFF);
    expect(handler.circuitBreakerEnabled).toBe(true);
    expect(handler.failureThreshold).toBe(5);
  });

  it('should create handler for rate-limited operations', () => {
    const handler = RetryHandlerFactory.createForRateLimited();
    
    expect(handler.maxRetries).toBe(5);
    expect(handler.baseDelayMs).toBe(5000);
    expect(handler.maxDelayMs).toBe(300000);
    expect(handler.circuitBreakerEnabled).toBe(false);
  });
});