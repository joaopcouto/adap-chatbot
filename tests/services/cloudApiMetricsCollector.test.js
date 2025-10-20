import { CloudApiMetricsCollector } from '../../src/services/cloudApiMetricsCollector.js';

describe('CloudApiMetricsCollector', () => {
  let metricsCollector;

  beforeEach(() => {
    metricsCollector = new CloudApiMetricsCollector();
  });

  describe('recordRequest', () => {
    it('should record successful request metrics', () => {
      const requestData = {
        endpoint: '/messages',
        method: 'POST',
        status: 200,
        duration: 1500,
        operation: 'sendTextMessage',
        success: true,
        requestId: 'req_123',
        correlationId: 'corr_456'
      };

      metricsCollector.recordRequest(requestData);

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.successful).toBe(1);
      expect(metrics.requests.failed).toBe(0);
      expect(metrics.requests.successRate).toBe(100);
      expect(metrics.requests.errorRate).toBe(0);
      expect(metrics.performance.averageDuration).toBe(1500);
    });

    it('should record failed request metrics', () => {
      const requestData = {
        endpoint: '/messages',
        method: 'POST',
        status: 400,
        duration: 800,
        operation: 'sendTextMessage',
        success: false,
        requestId: 'req_123'
      };

      metricsCollector.recordRequest(requestData);

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.successful).toBe(0);
      expect(metrics.requests.failed).toBe(1);
      expect(metrics.requests.successRate).toBe(0);
      expect(metrics.requests.errorRate).toBe(100);
    });

    it('should track metrics by endpoint', () => {
      metricsCollector.recordRequest({
        endpoint: '/messages',
        method: 'POST',
        status: 200,
        success: true
      });

      metricsCollector.recordRequest({
        endpoint: '/media',
        method: 'GET',
        status: 200,
        success: true
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.requests.byEndpoint['POST /messages']).toEqual({
        total: 1,
        successful: 1,
        failed: 0
      });
      expect(metrics.requests.byEndpoint['GET /media']).toEqual({
        total: 1,
        successful: 1,
        failed: 0
      });
    });
  });

  describe('recordError', () => {
    it('should record error metrics', () => {
      const errorData = {
        errorType: 'RATE_LIMIT_ERROR',
        errorCode: 429,
        status: 429,
        operation: 'sendTextMessage',
        isRateLimit: true
      };

      metricsCollector.recordError(errorData);

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.rateLimits).toBe(1);
      expect(metrics.errors.byType['RATE_LIMIT_ERROR']).toBe(1);
      expect(metrics.errors.byCode[429]).toBe(1);
    });

    it('should track different error types', () => {
      metricsCollector.recordError({
        errorType: 'AUTH_ERROR',
        isAuthFailure: true
      });

      metricsCollector.recordError({
        errorType: 'NETWORK_ERROR',
        isNetworkError: true
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.errors.total).toBe(2);
      expect(metrics.errors.authFailures).toBe(1);
      expect(metrics.errors.networkErrors).toBe(1);
    });
  });

  describe('recordMessage', () => {
    it('should record message metrics', () => {
      metricsCollector.recordMessage({
        type: 'text',
        status: 'sent',
        messageId: 'msg_123',
        operation: 'send'
      });

      metricsCollector.recordMessage({
        type: 'text',
        status: 'delivered',
        messageId: 'msg_123'
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.messages.sent).toBe(1);
      expect(metrics.messages.delivered).toBe(1);
      expect(metrics.messages.byType.text).toBe(2);
      expect(metrics.messages.deliveryRate).toBe(100);
    });

    it('should track failed messages', () => {
      metricsCollector.recordMessage({
        type: 'template',
        status: 'sent',
        operation: 'send'
      });

      metricsCollector.recordMessage({
        type: 'template',
        status: 'failed'
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.messages.sent).toBe(1);
      expect(metrics.messages.failed).toBe(1);
      expect(metrics.messages.byType.template).toBe(2);
    });
  });

  describe('recordWebhook', () => {
    it('should record webhook metrics', () => {
      metricsCollector.recordWebhook({
        type: 'message',
        processed: true,
        failed: false
      });

      metricsCollector.recordWebhook({
        type: 'status',
        processed: false,
        failed: true
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.webhooks.received).toBe(2);
      expect(metrics.webhooks.processed).toBe(1);
      expect(metrics.webhooks.failed).toBe(1);
      expect(metrics.webhooks.byType.message).toBe(1);
      expect(metrics.webhooks.byType.status).toBe(1);
    });
  });

  describe('recordRateLimit', () => {
    it('should record rate limit metrics', () => {
      metricsCollector.recordRateLimit({
        endpoint: '/messages',
        retryAfter: 60
      });

      metricsCollector.recordRateLimit({
        endpoint: '/messages',
        retryAfter: 30
      });

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.rateLimiting.hits).toBe(2);
      expect(metrics.rateLimiting.totalWaitTime).toBe(90);
      expect(metrics.rateLimiting.averageWaitTime).toBe(45);
      expect(metrics.rateLimiting.byEndpoint['/messages']).toEqual({
        hits: 2,
        totalWaitTime: 90
      });
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate 95th percentile correctly', () => {
      const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      const p95 = metricsCollector.calculatePercentile(values, 95);
      expect(p95).toBe(1000); // 95th percentile of 10 values
    });

    it('should handle empty array', () => {
      const p95 = metricsCollector.calculatePercentile([], 95);
      expect(p95).toBe(0);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status with good metrics', () => {
      // Record some successful requests
      for (let i = 0; i < 10; i++) {
        metricsCollector.recordRequest({
          endpoint: '/messages',
          method: 'POST',
          status: 200,
          duration: 1000,
          success: true
        });
      }

      const health = metricsCollector.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('healthy');
      expect(health.checks.errorRate.healthy).toBe(true);
      expect(health.checks.averageResponseTime.healthy).toBe(true);
    });

    it('should return unhealthy status with high error rate', () => {
      // Record failed requests
      for (let i = 0; i < 5; i++) {
        metricsCollector.recordRequest({
          endpoint: '/messages',
          method: 'POST',
          status: 500,
          duration: 1000,
          success: false
        });
      }

      // Record some successful requests
      for (let i = 0; i < 5; i++) {
        metricsCollector.recordRequest({
          endpoint: '/messages',
          method: 'POST',
          status: 200,
          duration: 1000,
          success: true
        });
      }

      const health = metricsCollector.getHealthStatus();
      expect(health.healthy).toBe(false);
      expect(health.status).toBe('degraded');
      expect(health.checks.errorRate.healthy).toBe(false);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Record some data
      metricsCollector.recordRequest({
        endpoint: '/messages',
        method: 'POST',
        status: 200,
        duration: 1000,
        success: true
      });

      metricsCollector.recordError({
        errorType: 'TEST_ERROR'
      });

      // Reset metrics
      metricsCollector.resetMetrics();

      const metrics = metricsCollector.getMetricsSummary();
      expect(metrics.requests.total).toBe(0);
      expect(metrics.errors.total).toBe(0);
      expect(metrics.messages.sent).toBe(0);
      expect(metrics.webhooks.received).toBe(0);
      expect(metrics.rateLimiting.hits).toBe(0);
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics in JSON format', () => {
      metricsCollector.recordRequest({
        endpoint: '/messages',
        method: 'POST',
        status: 200,
        success: true
      });

      const exported = metricsCollector.exportMetrics('json');
      expect(exported).toHaveProperty('requests');
      expect(exported).toHaveProperty('performance');
      expect(exported).toHaveProperty('errors');
      expect(exported.requests.total).toBe(1);
    });

    it('should export metrics in Prometheus format', () => {
      metricsCollector.recordRequest({
        endpoint: '/messages',
        method: 'POST',
        status: 200,
        success: true
      });

      const exported = metricsCollector.exportMetrics('prometheus');
      expect(typeof exported).toBe('string');
      expect(exported).toContain('whatsapp_cloud_api_requests_total 1');
      expect(exported).toContain('# HELP');
      expect(exported).toContain('# TYPE');
    });
  });
});