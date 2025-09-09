import request from 'supertest';
import express from 'express';
import googleIntegrationRouter from '../../src/routes/googleIntegration.js';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/google', googleIntegrationRouter);

describe('Google Integration Routes - Basic Tests', () => {
  describe('POST /api/google/auth-url', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/auth-url')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });
  });

  describe('POST /api/google/connect', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/connect')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });

    it('should return 400 if authorization code is missing', async () => {
      const response = await request(app)
        .post('/api/google/connect')
        .send({ phoneNumber: '+5511999999999' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authorization code is required');
    });
  });

  describe('POST /api/google/disconnect', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/disconnect')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });
  });

  describe('POST /api/google/status', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/status')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });
  });

  describe('POST /api/google/preferences', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/preferences')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });
  });

  describe('POST /api/google/calendars', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/calendars')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });
  });
});