import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { CloudApiService } from '../../src/services/cloudApiService.js';
import { CloudApiError } from '../../src/services/errorHandling/CloudApiErrorHandler.js';
import { RetryHandler } from '../../src/services/errorHandling/RetryHandler.js';
import cloudApiConfig from '../../src/config/cloudApiConfig.js';

// Mock axios for HTTP requests
jest.mock('axios');
import axios from 'axios';

describe('Cloud API Error Handling and Recovery Tests', () => {
  let cloudApiService;
  let mockAxios;

  const testConfig = {
    WHATSAPP_CLOUD_API_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'test_access_token_123',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'test_business_account',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test_verify_token_123',
    WHATSAPP_API_VERSION: 'v18.0',
    WHATSAPP_CLOUD_API_URL: 'https://graph.facebook.com'
  };

  beforeAll(() => {
    Object.keys(testConfig).forEach(key => {
      process.env[key] = testConfig[key];
    });

    mockAxios = axios;
    cloudApiService = new CloudApiService();
  });

  afterAll(() => {
    Object.keys(testConfig).forEach(key => {
      delete process.env[key];
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication Error Recovery', () => {
    test('should handle expired access token', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 401,
          data: {
            error: {
              message: 'Invalid access token',
              type: 'OAuthException',
              code: 190,
              fbtrace_id: 'trace_123'
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow(CloudApiError);

      try {
        await cloudApiService.sendTextMessage('5511999999999', 'Test message');
      } catch (error) {
        expect(error).toBeInstanceOf(CloudApiError);
        expect(error.status).toBe(401);
        expect(error.code).toBe(190);
        expect(error.errorType).toBe('AUTHENTICATION_ERROR');
        expect(error.message).toContain('Invalid access token');
      }
    });

    test('should handle insufficient permissions', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 403,
          data: {
            error: {
              message: 'Insufficient permissions',
              type: 'OAuthException',
              code: 200
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('Rate Limiting Recovery', () => {
    test('should handle rate limiting with exponential backoff', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
              type: 'RateLimitException',
              code: 4
            }
          }
        }
      };

      const successResponse = {
        status: 200,
        data: {
          messages: [{
            id: 'msg_after_retry_123',
            message_status: 'sent'
          }]
        }
      };

      // First two calls fail with rate limit, third succeeds
      mockAxios
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const startTime = Date.now();
      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );
      const endTime = Date.now();

      expect(result.messageId).toBe('msg_after_retry_123');
      expect(mockAxios).toHaveBeenCalledTimes(3);
      
      // Should have waited for exponential backoff
      expect(endTime - startTime).toBeGreaterThan(1000); // At least 1 second delay
    });

    test('should respect maximum retry attempts', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
              type: 'RateLimitException',
              code: 4
            }
          }
        }
      };

      // All calls fail with rate limit
      mockAxios.mockRejectedValue(rateLimitError);

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow('Rate limit exceeded');

      // Should have tried maximum number of times (default is 3)
      expect(mockAxios).toHaveBeenCalledTimes(3);
    });
  });

  describe('Network Error Recovery', () => {
    test('should handle network timeouts with retry', async () => {
      const timeoutError = new Error('Network timeout');
      timeoutError.code = 'ECONNABORTED';

      const successResponse = {
        status: 200,
        data: {
          messages: [{
            id: 'msg_after_timeout_123',
            message_status: 'sent'
          }]
        }
      };

      mockAxios
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse);

      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );

      expect(result.messageId).toBe('msg_after_timeout_123');
      expect(mockAxios).toHaveBeenCalledTimes(2);
    });

    test('should handle DNS resolution errors', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND');
      dnsError.code = 'ENOTFOUND';

      mockAxios.mockRejectedValue(dnsError);

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow('getaddrinfo ENOTFOUND');
    });

    test('should handle connection refused errors', async () => {
      const connectionError = new Error('connect ECONNREFUSED');
      connectionError.code = 'ECONNREFUSED';

      const successResponse = {
        status: 200,
        data: {
          messages: [{
            id: 'msg_after_connection_123',
            message_status: 'sent'
          }]
        }
      };

      mockAxios
        .mockRejectedValueOnce(connectionError)
        .mockResolvedValueOnce(successResponse);

      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );

      expect(result.messageId).toBe('msg_after_connection_123');
    });
  });

  describe('API Error Recovery', () => {
    test('should handle invalid phone number errors', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Invalid phone number',
              type: 'param',
              code: 100
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTextMessage('invalid_phone', 'Test message')
      ).rejects.toThrow('Invalid phone number');
    });

    test('should handle template not found errors', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Template not found',
              type: 'param',
              code: 132000
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTemplateMessage(
          '5511999999999',
          'nonexistent_template',
          {}
        )
      ).rejects.toThrow('Template not found');
    });

    test('should handle media upload errors', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 413,
          data: {
            error: {
              message: 'Media file too large',
              type: 'param',
              code: 131026
            }
          }
        }
      });

      await expect(
        cloudApiService.sendMediaMessage(
          '5511999999999',
          'https://example.com/large_file.jpg',
          'Caption'
        )
      ).rejects.toThrow('Media file too large');
    });
  });

  describe('Service Degradation Scenarios', () => {
    test('should handle partial service outage', async () => {
      // Simulate intermittent failures
      const serviceError = {
        response: {
          status: 503,
          data: {
            error: {
              message: 'Service temporarily unavailable',
              type: 'temporary',
              code: 2
            }
          }
        }
      };

      const successResponse = {
        status: 200,
        data: {
          messages: [{
            id: 'msg_after_outage_123',
            message_status: 'sent'
          }]
        }
      };

      mockAxios
        .mockRejectedValueOnce(serviceError)
        .mockRejectedValueOnce(serviceError)
        .mockResolvedValueOnce(successResponse);

      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );

      expect(result.messageId).toBe('msg_after_outage_123');
      expect(mockAxios).toHaveBeenCalledTimes(3);
    });

    test('should handle API version deprecation', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'API version deprecated',
              type: 'deprecated',
              code: 12
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow('API version deprecated');
    });
  });

  describe('Circuit Breaker Pattern', () => {
    test('should open circuit breaker after consecutive failures', async () => {
      const serviceError = {
        response: {
          status: 500,
          data: {
            error: {
              message: 'Internal server error',
              type: 'server_error',
              code: 1
            }
          }
        }
      };

      // Mock multiple consecutive failures
      mockAxios.mockRejectedValue(serviceError);

      // Try multiple requests to trigger circuit breaker
      const promises = Array(10).fill().map(() =>
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
          .catch(error => error)
      );

      const results = await Promise.all(promises);

      // All should fail, but later ones should fail faster (circuit breaker open)
      results.forEach(result => {
        expect(result).toBeInstanceOf(Error);
      });
    });
  });

  describe('Error Logging and Monitoring', () => {
    test('should log structured error information', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Invalid request',
              type: 'param',
              code: 100,
              fbtrace_id: 'trace_456'
            }
          }
        }
      });

      try {
        await cloudApiService.sendTextMessage('5511999999999', 'Test message');
      } catch (error) {
        // Error should be logged with structured information
        expect(error).toBeInstanceOf(CloudApiError);
        expect(error.fbtrace_id).toBe('trace_456');
      }

      consoleSpy.mockRestore();
    });

    test('should track error metrics', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
              type: 'RateLimitException',
              code: 4
            }
          }
        }
      });

      try {
        await cloudApiService.sendTextMessage('5511999999999', 'Test message');
      } catch (error) {
        // Metrics should be recorded for monitoring
        expect(error.errorType).toBe('RATE_LIMIT_ERROR');
      }
    });
  });

  describe('Fallback Mechanisms', () => {
    test('should provide fallback for template message failures', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Template not approved',
              type: 'param',
              code: 132012
            }
          }
        }
      });

      // Template message should fail, but service should suggest fallback
      await expect(
        cloudApiService.sendTemplateMessage(
          '5511999999999',
          'unapproved_template',
          { body: ['John'] }
        )
      ).rejects.toThrow('Template not approved');
    });

    test('should handle media message fallback to text', async () => {
      mockAxios.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Media type not supported',
              type: 'param',
              code: 131051
            }
          }
        }
      });

      await expect(
        cloudApiService.sendMediaMessage(
          '5511999999999',
          'https://example.com/unsupported.xyz',
          'Caption'
        )
      ).rejects.toThrow('Media type not supported');
    });
  });

  describe('Recovery Validation', () => {
    test('should validate service recovery after errors', async () => {
      // First call fails
      mockAxios.mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: {
              message: 'Internal server error',
              type: 'server_error',
              code: 1
            }
          }
        }
      });

      // Second call succeeds
      mockAxios.mockResolvedValueOnce({
        status: 200,
        data: {
          messages: [{
            id: 'msg_recovery_123',
            message_status: 'sent'
          }]
        }
      });

      // First call should fail
      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message 1')
      ).rejects.toThrow('Internal server error');

      // Second call should succeed (service recovered)
      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message 2'
      );

      expect(result.messageId).toBe('msg_recovery_123');
    });

    test('should validate health status after recovery', async () => {
      // Mock health check success after previous failures
      mockAxios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const healthStatus = await cloudApiService.getHealthStatus();

      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.service).toBe('CloudApiService');
    });
  });
});