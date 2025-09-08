import request from 'supertest';
import express from 'express';
import monitoringRouter from '../../src/routes/monitoring.js';

// Create a test app
const app = express();
app.use(express.json());
app.use('/api/monitoring', monitoringRouter);

describe('Monitoring Endpoints', () => {
  describe('Google Calendar Metrics', () => {
    it('should return Google Calendar metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('syncMetrics');
      expect(response.body.data).toHaveProperty('responseTimeMetrics');
      expect(response.body.data).toHaveProperty('errorDistribution');
      expect(response.body.data).toHaveProperty('authenticationMetrics');
      expect(response.body.data).toHaveProperty('queueMetrics');
      expect(response.body.data).toHaveProperty('healthIndicators');
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should return sync success rate metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/success-rate')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('timeRange');
      expect(response.body.data).toHaveProperty('totalOperations');
      expect(response.body.data).toHaveProperty('successRate');
      expect(response.body.data).toHaveProperty('failureRate');
      expect(response.body.data).toHaveProperty('errorDistribution');
      expect(response.body.data).toHaveProperty('currentMetrics');
    });

    it('should return performance metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/performance')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('responseTimeMetrics');
      expect(response.body.data).toHaveProperty('performanceHealth');
      expect(response.body.data).toHaveProperty('slowOperations');
      expect(response.body.data).toHaveProperty('thresholds');
    });

    it('should return error distribution metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/errors')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('errorDistribution');
      expect(response.body.data).toHaveProperty('authenticationMetrics');
      expect(response.body.data).toHaveProperty('topErrorPatterns');
      expect(response.body.data).toHaveProperty('healthIndicators');
    });

    it('should return health check status', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('overallStatus');
      expect(response.body.data).toHaveProperty('healthScore');
      expect(response.body.data).toHaveProperty('components');
      expect(response.body.data).toHaveProperty('statistics');
      expect(response.body.data.components).toHaveProperty('syncService');
      expect(response.body.data.components).toHaveProperty('authentication');
      expect(response.body.data.components).toHaveProperty('retryQueue');
      expect(response.body.data.components).toHaveProperty('performance');
    });
  });

  describe('Alert Management', () => {
    it('should trigger alert check', async () => {
      const response = await request(app)
        .post('/api/monitoring/google-calendar/check-alerts')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('alertsTriggered');
      expect(response.body.data).toHaveProperty('alerts');
      expect(response.body.data).toHaveProperty('metricsSnapshot');
    });

    it('should return alert status', async () => {
      const response = await request(app)
        .get('/api/monitoring/google-calendar/alerts/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('alertState');
      expect(response.body.data).toHaveProperty('config');
      expect(response.body.data).toHaveProperty('lastCheck');
    });

    it('should reset alert states', async () => {
      const response = await request(app)
        .post('/api/monitoring/google-calendar/alerts/reset')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reset successfully');
    });
  });

  describe('Alerting Job Management', () => {
    it('should return alerting job metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/alerting/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('lastRunTime');
      expect(response.body.data).toHaveProperty('totalChecks');
      expect(response.body.data).toHaveProperty('totalAlertsTriggered');
      expect(response.body.data).toHaveProperty('isRunning');
      expect(response.body.data).toHaveProperty('config');
    });

    it('should return alerting job health', async () => {
      const response = await request(app)
        .get('/api/monitoring/alerting/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('healthScore');
      expect(response.body.data).toHaveProperty('enabled');
    });

    it('should trigger alerting job manually', async () => {
      const response = await request(app)
        .post('/api/monitoring/alerting/force-run')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('triggered successfully');
    });
  });

  describe('Metrics Management', () => {
    it('should reset metrics collector', async () => {
      const response = await request(app)
        .post('/api/monitoring/google-calendar/reset-metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reset successfully');
      expect(response.body).toHaveProperty('previousMetrics');
    });
  });

  describe('Legacy Sync Retry Endpoints', () => {
    it('should return sync retry job metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/sync-retry/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('lastRunTime');
      expect(response.body.data).toHaveProperty('totalProcessed');
      expect(response.body.data).toHaveProperty('isRunning');
    });

    it('should return sync retry job health', async () => {
      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('healthScore');
    });

    it('should return queue statistics', async () => {
      const response = await request(app)
        .get('/api/monitoring/sync-retry/queue-stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('percentages');
    });
  });
});