import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';

// Mock external dependencies before importing
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  cloudApiOperationStart: jest.fn(),
  cloudApiOperationSuccess: jest.fn(),
  cloudApiOperationFailure: jest.fn()
};

const mockUser = {
  findOne: jest.fn()
};

const mockTransaction = {
  findOne: jest.fn(),
  save: jest.fn()
};

// Mock modules
jest.unstable_mockModule('../../src/helpers/logger.js', () => ({
  structuredLogger: mockLogger,
  devLog: jest.fn(),
  generateCorrelationId: jest.fn(() => 'test-correlation-id')
}));

jest.unstable_mockModule('../../src/services/aiService.js', () => ({
  interpretMessageWithAI: jest.fn(),
  transcribeAudioWithWhisper: jest.fn(),
  interpretDocumentWithAI: jest.fn()
}));

jest.unstable_mockModule('../../src/models/User.js', () => ({
  default: mockUser
}));

jest.unstable_mockModule('../../src/models/Transaction.js', () => ({
  default: mockTransaction
}));

jest.unstable_mockModule('../../src/models/Category.js', () => ({
  default: { findOne: jest.fn() }
}));

jest.unstable_mockModule('../../src/models/PaymentMethod.js', () => ({
  default: { findOne: jest.fn() }
}));

jest.unstable_mockModule('../../src/models/UserStats.js', () => ({
  default: { findOne: jest.fn() }
}));

jest.unstable_mockModule('../../src/models/Reminder.js', () => ({
  default: { save: jest.fn() }
}));

jest.unstable_mockModule('axios', () => ({
  default: jest.fn()
}));

// Import after mocking
const { CloudApiService } = await import('../../src/services/cloudApiService.js');
const cloudApiConfig = await import('../../src/config/cloudApiConfig.js');
const webhookRouter = await import('../../src/routes/webhook.js');
const { structuredLogger } = await import('../../src/helpers/logger.js');

describe('Cloud API End-to-End Integration Tests', () => {
  let app;
  let cloudApiService;
  let mockAxios;

  // Test configuration
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
    // Set up test environment variables
    Object.keys(testConfig).forEach(key => {
      process.env[key] = testConfig[key];
    });

    // Create Express app for testing
    app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    
    // Add raw body capture middleware for webhook signature verification
    app.use('/webhook', (req, res, next) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        req.rawBody = data;
        next();
      });
    });
    
    app.use('/webhook', webhookRouter);

    // Mock axios for HTTP requests
    mockAxios = {
      request: jest.fn(),
      get: jest.fn(),
      post: jest.fn()
    };

    // Initialize Cloud API service
    cloudApiService = new CloudApiService();
  });

  afterAll(() => {
    // Clean up environment variables
    Object.keys(testConfig).forEach(key => {
      delete process.env[key];
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset axios mocks
    mockAxios.request.mockReset();
    mockAxios.get.mockReset();
    mockAxios.post.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Webhook Verification', () => {
    test('should verify webhook with correct token', async () => {
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': testConfig.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
          'hub.challenge': 'test_challenge_123'
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('test_challenge_123');
    });

    test('should reject webhook verification with incorrect token', async () => {
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'test_challenge_123'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('invalid token');
    });

    test('should reject webhook verification with incorrect mode', async () => {
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'invalid_mode',
          'hub.verify_token': testConfig.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
          'hub.challenge': 'test_challenge_123'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid mode');
    });
  });

  describe('Cloud API Message Sending', () => {
    beforeEach(() => {
      // Mock successful API responses
      mockAxios.request.mockResolvedValue({
        status: 200,
        data: {
          messages: [{
            id: 'msg_test_123',
            message_status: 'sent'
          }]
        }
      });
    });

    test('should send text message successfully', async () => {
      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message content'
      );

      expect(result).toMatchObject({
        messageId: 'msg_test_123',
        status: 'sent',
        provider: 'cloud-api',
        type: 'text'
      });

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: expect.stringContaining('/messages'),
          data: expect.objectContaining({
            messaging_product: 'whatsapp',
            to: '5511999999999',
            type: 'text',
            text: { body: 'Test message content' }
          })
        })
      );
    });

    test('should send template message successfully', async () => {
      const templateVariables = {
        body: ['John', '100.00']
      };

      const result = await cloudApiService.sendTemplateMessage(
        '5511999999999',
        'payment_reminder',
        templateVariables,
        'pt_BR'
      );

      expect(result).toMatchObject({
        messageId: 'msg_test_123',
        status: 'sent',
        provider: 'cloud-api',
        type: 'template',
        templateName: 'payment_reminder'
      });

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messaging_product: 'whatsapp',
            to: '5511999999999',
            type: 'template',
            template: expect.objectContaining({
              name: 'payment_reminder',
              language: { code: 'pt_BR' },
              components: expect.arrayContaining([
                expect.objectContaining({
                  type: 'body',
                  parameters: expect.arrayContaining([
                    { type: 'text', text: 'John' },
                    { type: 'text', text: '100.00' }
                  ])
                })
              ])
            })
          })
        })
      );
    });

    test('should send media message successfully', async () => {
      const result = await cloudApiService.sendMediaMessage(
        '5511999999999',
        'https://example.com/image.jpg',
        'Test image caption',
        'image'
      );

      expect(result).toMatchObject({
        messageId: 'msg_test_123',
        status: 'sent',
        provider: 'cloud-api',
        type: 'media',
        mediaType: 'image'
      });

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messaging_product: 'whatsapp',
            to: '5511999999999',
            type: 'image',
            image: {
              link: 'https://example.com/image.jpg',
              caption: 'Test image caption'
            }
          })
        })
      );
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle authentication errors', async () => {
      mockAxios.request.mockRejectedValue({
        response: {
          status: 401,
          data: {
            error: {
              message: 'Invalid access token',
              type: 'OAuthException',
              code: 190
            }
          }
        }
      });

      await expect(
        cloudApiService.sendTextMessage('5511999999999', 'Test message')
      ).rejects.toThrow('Invalid access token');
    });

    test('should handle rate limiting with retry', async () => {
      // First call fails with rate limit
      mockAxios.request
        .mockRejectedValueOnce({
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
        })
        // Second call succeeds
        .mockResolvedValueOnce({
          status: 200,
          data: {
            messages: [{
              id: 'msg_retry_123',
              message_status: 'sent'
            }]
          }
        });

      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );

      expect(result.messageId).toBe('msg_retry_123');
      expect(mockAxios.request).toHaveBeenCalledTimes(2);
    });

    test('should handle network errors with retry', async () => {
      // First call fails with network error
      mockAxios.request
        .mockRejectedValueOnce(new Error('Network timeout'))
        // Second call succeeds
        .mockResolvedValueOnce({
          status: 200,
          data: {
            messages: [{
              id: 'msg_network_retry_123',
              message_status: 'sent'
            }]
          }
        });

      const result = await cloudApiService.sendTextMessage(
        '5511999999999',
        'Test message'
      );

      expect(result.messageId).toBe('msg_network_retry_123');
      expect(mockAxios.request).toHaveBeenCalledTimes(2);
    });

    test('should handle invalid phone number format', async () => {
      await expect(
        cloudApiService.sendTextMessage('invalid_phone', 'Test message')
      ).rejects.toThrow('Invalid phone number format');
    });

    test('should handle invalid media URL', async () => {
      await expect(
        cloudApiService.sendMediaMessage(
          '5511999999999',
          'not_a_valid_url',
          'Caption'
        )
      ).rejects.toThrow('Invalid media URL format');
    });
  });

  describe('Webhook Message Processing', () => {
    const createWebhookSignature = (body, secret) => {
      return crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
    };

    test('should process incoming text message webhook', async () => {
      const webhookBody = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'test_entry_id',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '5511999999999',
                phone_number_id: testConfig.WHATSAPP_PHONE_NUMBER_ID
              },
              messages: [{
                from: '5511888888888',
                id: 'incoming_msg_123',
                timestamp: '1234567890',
                text: {
                  body: 'Hello from user'
                },
                type: 'text'
              }]
            },
            field: 'messages'
          }]
        }]
      };

      const signature = createWebhookSignature(
        webhookBody,
        testConfig.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      );

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(webhookBody);

      expect(response.status).toBe(200);
    });

    test('should process incoming media message webhook', async () => {
      const webhookBody = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'test_entry_id',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '5511999999999',
                phone_number_id: testConfig.WHATSAPP_PHONE_NUMBER_ID
              },
              messages: [{
                from: '5511888888888',
                id: 'incoming_media_123',
                timestamp: '1234567890',
                image: {
                  id: 'media_id_123',
                  mime_type: 'image/jpeg',
                  sha256: 'image_hash_123'
                },
                type: 'image'
              }]
            },
            field: 'messages'
          }]
        }]
      };

      const signature = createWebhookSignature(
        webhookBody,
        testConfig.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      );

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', `sha256=${signature}`)
        .send(webhookBody);

      expect(response.status).toBe(200);
    });

    test('should reject webhook with invalid signature', async () => {
      const webhookBody = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'test_entry_id',
          changes: [{
            value: {
              messages: [{
                from: '5511888888888',
                id: 'incoming_msg_123',
                text: { body: 'Hello' },
                type: 'text'
              }]
            },
            field: 'messages'
          }]
        }]
      };

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=invalid_signature')
        .send(webhookBody);

      expect(response.status).toBe(403);
    });
  });

  describe('Service Health and Monitoring', () => {
    test('should return healthy status when service is working', async () => {
      mockAxios.request.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const healthStatus = await cloudApiService.getHealthStatus();

      expect(healthStatus).toMatchObject({
        service: 'CloudApiService',
        status: 'healthy',
        enabled: true
      });
    });

    test('should return unhealthy status when service has issues', async () => {
      mockAxios.request.mockRejectedValue(new Error('Service unavailable'));

      const healthStatus = await cloudApiService.getHealthStatus();

      expect(healthStatus).toMatchObject({
        service: 'CloudApiService',
        status: 'unhealthy',
        enabled: true
      });
    });
  });

  describe('Phone Number Formatting', () => {
    test('should format Brazilian phone numbers correctly', () => {
      const testCases = [
        { input: '11999999999', expected: '5511999999999' },
        { input: '+5511999999999', expected: '5511999999999' },
        { input: 'whatsapp:+5511999999999', expected: '5511999999999' },
        { input: '5511999999999', expected: '5511999999999' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = cloudApiService.formatPhoneNumber(input);
        expect(result).toBe(expected);
      });
    });

    test('should throw error for invalid phone numbers', () => {
      const invalidNumbers = ['', '123', 'invalid', null, undefined];

      invalidNumbers.forEach(number => {
        expect(() => {
          cloudApiService.formatPhoneNumber(number);
        }).toThrow();
      });
    });
  });

  describe('Message Content Validation', () => {
    test('should validate text message length', () => {
      const shortMessage = 'Hello';
      const longMessage = 'a'.repeat(5000); // Exceeds typical limits

      expect(cloudApiService.validateMessageContent(shortMessage)).toBe(true);
      expect(() => {
        cloudApiService.validateMessageContent(longMessage);
      }).toThrow();
    });

    test('should validate media URLs', () => {
      const validUrls = [
        'https://example.com/image.jpg',
        'https://example.com/document.pdf',
        'https://example.com/video.mp4'
      ];

      const invalidUrls = [
        'not_a_url',
        'ftp://example.com/file.txt',
        'https://example.com/file.exe'
      ];

      validUrls.forEach(url => {
        expect(() => {
          cloudApiService.validateMediaUrl(url);
        }).not.toThrow();
      });

      invalidUrls.forEach(url => {
        expect(() => {
          cloudApiService.validateMediaUrl(url);
        }).toThrow();
      });
    });
  });

  describe('Template Message Components', () => {
    test('should build template components correctly', () => {
      const variables = {
        body: ['John Doe', '100.50'],
        header: ['Invoice #123']
      };

      const components = cloudApiService.buildTemplateComponents(variables);

      expect(components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'John Doe' },
            { type: 'text', text: '100.50' }
          ]
        },
        {
          type: 'header',
          parameters: [
            { type: 'text', text: 'Invoice #123' }
          ]
        }
      ]);
    });

    test('should handle single parameter templates', () => {
      const variables = {
        body: 'Single parameter'
      };

      const components = cloudApiService.buildTemplateComponents(variables);

      expect(components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Single parameter' }
          ]
        }
      ]);
    });
  });

  describe('Media Type Detection', () => {
    test('should detect media types from URLs', () => {
      const testCases = [
        { url: 'https://example.com/image.jpg', expected: 'image' },
        { url: 'https://example.com/video.mp4', expected: 'video' },
        { url: 'https://example.com/audio.mp3', expected: 'audio' },
        { url: 'https://example.com/document.pdf', expected: 'document' },
        { url: 'https://example.com/unknown.xyz', expected: 'document' }
      ];

      testCases.forEach(({ url, expected }) => {
        const result = cloudApiService.detectMediaType(url);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Configuration Validation', () => {
    test('should validate required configuration', () => {
      expect(() => {
        new CloudApiService();
      }).not.toThrow();
    });

    test('should throw error for missing configuration', () => {
      const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      expect(() => {
        new CloudApiService();
      }).toThrow('configuration is incomplete');

      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    });
  });
});