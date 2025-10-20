import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

// Mock dependencies
const mockStructuredLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../src/helpers/logger.js', () => ({
  structuredLogger: mockStructuredLogger
}));

// Mock user utilities
const mockUserUtils = {
  findOrCreateUser: jest.fn(),
  isUserRegistered: jest.fn(),
  getUserById: jest.fn()
};

jest.mock('../../src/helpers/userUtils.js', () => mockUserUtils);

// Mock message processing - simplified for testing
const mockMessageProcessor = {
  processIncomingMessage: jest.fn().mockResolvedValue({ success: true })
};

describe('Cloud API Webhook Integration Tests', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };
    
    // Set test environment variables
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token-123456789012345678901234567890';
    process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token-1234567890123456789012345678901234567890123456789012345678901234567890';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '123456789012345';
    process.env.WHATSAPP_APP_SECRET = 'test-app-secret-123456789012345678901234567890';
    
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockUserUtils.findOrCreateUser.mockResolvedValue({
      _id: 'user123',
      phoneNumber: '5511999999999',
      name: 'Test User'
    });
    mockUserUtils.isUserRegistered.mockResolvedValue(true);

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Webhook Verification (GET)', () => {
    it('should verify webhook with correct parameters', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('test-challenge-12345');
    });

    it('should reject verification with invalid token', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'invalid-token',
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('invalid token');
    });

    it('should reject verification with invalid mode', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid mode');
    });

    it('should handle missing parameters', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe'
          // Missing verify_token and challenge
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Cloud API Message Processing (POST)', () => {
    const createValidSignature = (payload, secret) => {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(JSON.stringify(payload));
      return `sha256=${hmac.digest('hex')}`;
    };

    it('should process text message successfully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const textMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.message123',
                      timestamp: '1234567890',
                      text: {
                        body: 'Hello, this is a test message!'
                      },
                      type: 'text'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(textMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(textMessagePayload);

      expect(response.status).toBe(200);
      expect(mockUserUtils.findOrCreateUser).toHaveBeenCalledWith(
        '5511999999999',
        'Test User'
      );
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalled();
    });

    it('should process image message successfully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const imageMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.image123',
                      timestamp: '1234567890',
                      image: {
                        id: 'media-id-123',
                        mime_type: 'image/jpeg',
                        sha256: 'image-hash-123',
                        caption: 'Check out this image!'
                      },
                      type: 'image'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(imageMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(imageMessagePayload);

      expect(response.status).toBe(200);
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'image',
          mediaId: 'media-id-123',
          caption: 'Check out this image!'
        })
      );
    });

    it('should process document message successfully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const documentMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.document123',
                      timestamp: '1234567890',
                      document: {
                        id: 'document-id-123',
                        mime_type: 'application/pdf',
                        sha256: 'document-hash-123',
                        filename: 'important-document.pdf',
                        caption: 'Important document attached'
                      },
                      type: 'document'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(documentMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(documentMessagePayload);

      expect(response.status).toBe(200);
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'document',
          mediaId: 'document-id-123',
          filename: 'important-document.pdf',
          caption: 'Important document attached'
        })
      );
    });

    it('should process interactive button message successfully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const interactiveMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.interactive123',
                      timestamp: '1234567890',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: 'button_yes',
                          title: 'Yes'
                        }
                      },
                      type: 'interactive'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(interactiveMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(interactiveMessagePayload);

      expect(response.status).toBe(200);
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interactive',
          interactiveType: 'button_reply',
          buttonId: 'button_yes',
          buttonTitle: 'Yes'
        })
      );
    });

    it('should handle message status updates', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const statusUpdatePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  statuses: [
                    {
                      id: 'wamid.status123',
                      status: 'delivered',
                      timestamp: '1234567890',
                      recipient_id: '5511999999999'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(statusUpdatePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(statusUpdatePayload);

      expect(response.status).toBe(200);
      // Status updates should be logged but not processed as messages
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Message status update'),
        expect.objectContaining({
          messageId: 'wamid.status123',
          status: 'delivered'
        })
      );
    });

    it('should reject webhook with invalid signature', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=invalid-signature')
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('signature verification failed');
    });

    it('should handle missing signature header', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Missing signature');
    });

    it('should handle malformed webhook payload', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const malformedPayload = {
        object: 'whatsapp_business_account'
        // Missing entry array
      };

      const signature = createValidSignature(malformedPayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(malformedPayload);

      expect(response.status).toBe(400);
      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid webhook payload'),
        expect.any(Object)
      );
    });

    it('should handle user registration errors gracefully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      // Mock user registration failure
      mockUserUtils.findOrCreateUser.mockRejectedValue(new Error('Database connection failed'));

      const textMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.message123',
                      timestamp: '1234567890',
                      text: {
                        body: 'Hello!'
                      },
                      type: 'text'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(textMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(textMessagePayload);

      expect(response.status).toBe(500);
      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing webhook'),
        expect.objectContaining({
          error: 'Database connection failed'
        })
      );
    });

    it('should handle multiple messages in single webhook', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const multiMessagePayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  },
                  contacts: [
                    {
                      profile: {
                        name: 'Test User'
                      },
                      wa_id: '5511999999999'
                    }
                  ],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.message1',
                      timestamp: '1234567890',
                      text: {
                        body: 'First message'
                      },
                      type: 'text'
                    },
                    {
                      from: '5511999999999',
                      id: 'wamid.message2',
                      timestamp: '1234567891',
                      text: {
                        body: 'Second message'
                      },
                      type: 'text'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(multiMessagePayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(multiMessagePayload);

      expect(response.status).toBe(200);
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle webhook with no messages gracefully', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const emptyPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id-123',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345'
                  }
                  // No messages or statuses
                }
              }
            ]
          }
        ]
      };

      const signature = createValidSignature(emptyPayload, process.env.WHATSAPP_APP_SECRET);

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .send(emptyPayload);

      expect(response.status).toBe(200);
      expect(mockMessageProcessor.processIncomingMessage).not.toHaveBeenCalled();
    });
  });

  describe('Security Tests', () => {
    it('should validate webhook signature correctly', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };

      // Test with correct signature
      const validSignature = createValidSignature(payload, process.env.WHATSAPP_APP_SECRET);
      const validResponse = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', validSignature)
        .send(payload);

      expect(validResponse.status).toBe(200);

      // Test with incorrect signature
      const invalidResponse = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=wrong-signature')
        .send(payload);

      expect(invalidResponse.status).toBe(403);
    });

    it('should handle signature timing attacks', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };

      const validSignature = createValidSignature(payload, process.env.WHATSAPP_APP_SECRET);
      const almostValidSignature = validSignature.slice(0, -1) + 'x'; // Change last character

      // Both should fail in similar time to prevent timing attacks
      const start1 = Date.now();
      const response1 = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=completely-wrong')
        .send(payload);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const response2 = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', almostValidSignature)
        .send(payload);
      const time2 = Date.now() - start2;

      expect(response1.status).toBe(403);
      expect(response2.status).toBe(403);
      
      // Times should be similar (within 50ms) to prevent timing attacks
      expect(Math.abs(time1 - time2)).toBeLessThan(50);
    });

    it('should rate limit webhook requests', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };
      const signature = createValidSignature(payload, process.env.WHATSAPP_APP_SECRET);

      // Make multiple rapid requests
      const promises = Array.from({ length: 20 }, () =>
        request(app)
          .post('/webhook')
          .set('X-Hub-Signature-256', signature)
          .send(payload)
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});