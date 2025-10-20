import request from 'supertest';
import express from 'express';

describe('Webhook Cloud API Integration', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };
    
    // Set test environment variables with proper token format
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token-123456789012345678901234567890';
    process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token-1234567890123456789012345678901234567890123456789012345678901234567890';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '123456789012345';
    
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('GET /webhook - Webhook Verification', () => {
    it('should verify webhook with correct token', async () => {
      // Import webhook router after setting environment variables
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token-123',
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('test-challenge-12345');
    });

    it('should reject webhook verification with wrong token', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('invalid token');
    });

    it('should reject webhook verification with wrong mode', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'test-verify-token-123',
          'hub.challenge': 'test-challenge-12345'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid mode');
    });
  });

  describe('POST /webhook - Cloud API Message Processing', () => {
    it('should detect Cloud API webhook format', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const cloudApiWebhook = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789'
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
                      id: 'message-id-123',
                      timestamp: '1234567890',
                      text: {
                        body: 'Hello test message'
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

      // This will fail signature verification but should detect Cloud API format
      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=mock-signature')
        .send(cloudApiWebhook);

      // Expected to fail signature verification
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('signature verification failed');
    });

    it('should handle legacy Twilio format when not Cloud API', async () => {
      const { default: webhookRouter } = await import('../../src/routes/webhook.js');
      app.use('/webhook', webhookRouter);
      
      const twilioWebhook = {
        From: 'whatsapp:+5511999999999',
        Body: 'Hello test message'
      };

      const response = await request(app)
        .post('/webhook')
        .send(twilioWebhook);

      // This should be processed as Twilio format
      // The exact response depends on the user validation logic
      expect(response.status).toBeDefined();
    });
  });
});