import metricsCollector from '../../src/services/metricsCollector.js';

describe('MetricsCollector', () => {
  beforeEach(() => {
    // Reset metrics before each test
    metricsCollector.resetMetrics();
  });

  describe('recordSyncOperation', () => {
    it('should record successful sync operations', () => {
      metricsCollector.recordSyncOperation('createEvent', true, 1000);
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.syncMetrics.totalOperations).toBe(1);
      expect(metrics.syncMetrics.successfulOperations).toBe(1);
      expect(metrics.syncMetrics.failedOperations).toBe(0);
      expect(metrics.syncMetrics.successRate).toBe(100);
    });

    it('should record failed sync operations with error types', () => {
      metricsCollector.recordSyncOperation('createEvent', false, 2000, 'AUTH_ERROR');
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.syncMetrics.totalOperations).toBe(1);
      expect(metrics.syncMetrics.successfulOperations).toBe(0);
      expect(metrics.syncMetrics.failedOperations).toBe(1);
      expect(metrics.syncMetrics.failureRate).toBe(100);
      expect(metrics.errorDistribution.AUTH_ERROR).toBe(1);
    });

    it('should track response times for different operations', () => {
      metricsCollector.recordSyncOperation('createEvent', true, 1000);
      metricsCollector.recordSyncOperation('updateEvent', true, 2000);
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.responseTimeMetrics.createEvent.count).toBe(1);
      expect(metrics.responseTimeMetrics.createEvent.average).toBe(1000);
      expect(metrics.responseTimeMetrics.updateEvent.count).toBe(1);
      expect(metrics.responseTimeMetrics.updateEvent.average).toBe(2000);
    });

    it('should calculate correct success rates with mixed operations', () => {
      // Record 7 successful and 3 failed operations
      for (let i = 0; i < 7; i++) {
        metricsCollector.recordSyncOperation('createEvent', true, 1000);
      }
      for (let i = 0; i < 3; i++) {
        metricsCollector.recordSyncOperation('createEvent', false, 1500, 'SERVER_ERROR');
      }
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.syncMetrics.totalOperations).toBe(10);
      expect(metrics.syncMetrics.successfulOperations).toBe(7);
      expect(metrics.syncMetrics.failedOperations).toBe(3);
      expect(metrics.syncMetrics.successRate).toBe(70);
      expect(metrics.syncMetrics.failureRate).toBe(30);
    });
  });

  describe('recordAuthIssue', () => {
    it('should record token refresh failures', () => {
      metricsCollector.recordAuthIssue('tokenRefresh', { reason: 'expired' });
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.authenticationMetrics.tokenRefreshFailures).toBe(1);
      expect(metrics.authenticationMetrics.reconnectionRequired).toBe(0);
      expect(metrics.authenticationMetrics.lastAuthFailure).toBeInstanceOf(Date);
    });

    it('should record reconnection required issues', () => {
      metricsCollector.recordAuthIssue('reconnectionRequired', { reason: 'invalid_grant' });
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.authenticationMetrics.tokenRefreshFailures).toBe(0);
      expect(metrics.authenticationMetrics.reconnectionRequired).toBe(1);
    });
  });

  describe('updateQueueMetrics', () => {
    it('should update current queue size', async () => {
      await metricsCollector.updateQueueMetrics(50);
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.queueMetrics.currentSize).toBe(50);
      expect(metrics.queueMetrics.maxSize).toBe(50);
    });

    it('should track maximum queue size', async () => {
      await metricsCollector.updateQueueMetrics(30);
      await metricsCollector.updateQueueMetrics(75);
      await metricsCollector.updateQueueMetrics(45);
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.queueMetrics.currentSize).toBe(45);
      expect(metrics.queueMetrics.maxSize).toBe(75);
    });
  });

  describe('getMetricsSummary', () => {
    it('should return comprehensive metrics summary', () => {
      // Add some test data
      metricsCollector.recordSyncOperation('createEvent', true, 1000);
      metricsCollector.recordSyncOperation('updateEvent', false, 2000, 'RATE_LIMIT');
      metricsCollector.recordAuthIssue('tokenRefresh', { reason: 'expired' });
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('syncMetrics');
      expect(metrics).toHaveProperty('responseTimeMetrics');
      expect(metrics).toHaveProperty('errorDistribution');
      expect(metrics).toHaveProperty('authenticationMetrics');
      expect(metrics).toHaveProperty('queueMetrics');
      expect(metrics).toHaveProperty('healthIndicators');
      
      expect(metrics.syncMetrics.totalOperations).toBe(2);
      expect(metrics.errorDistribution.RATE_LIMIT).toBe(1);
      expect(metrics.authenticationMetrics.tokenRefreshFailures).toBe(1);
    });
  });

  describe('health indicators', () => {
    it('should calculate healthy status with good metrics', () => {
      // Record mostly successful operations
      for (let i = 0; i < 95; i++) {
        metricsCollector.recordSyncOperation('createEvent', true, 1000);
      }
      for (let i = 0; i < 5; i++) {
        metricsCollector.recordSyncOperation('createEvent', false, 1000, 'RATE_LIMIT');
      }
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.healthIndicators.syncHealth).toBe('healthy');
      expect(metrics.healthIndicators.overall).toBe('healthy');
    });

    it('should calculate warning status with moderate issues', () => {
      // Record operations with moderate failure rate
      for (let i = 0; i < 80; i++) {
        metricsCollector.recordSyncOperation('createEvent', true, 1000);
      }
      for (let i = 0; i < 20; i++) {
        metricsCollector.recordSyncOperation('createEvent', false, 1000, 'SERVER_ERROR');
      }
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.healthIndicators.syncHealth).toBe('warning');
    });

    it('should calculate critical status with high failure rate', () => {
      // Record operations with high failure rate
      for (let i = 0; i < 40; i++) {
        metricsCollector.recordSyncOperation('createEvent', true, 1000);
      }
      for (let i = 0; i < 60; i++) {
        metricsCollector.recordSyncOperation('createEvent', false, 1000, 'AUTH_ERROR');
      }
      
      const metrics = metricsCollector.getMetricsSummary();
      
      expect(metrics.healthIndicators.syncHealth).toBe('critical');
      expect(metrics.healthIndicators.overall).toBe('critical');
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Add some test data
      metricsCollector.recordSyncOperation('createEvent', true, 1000);
      metricsCollector.recordAuthIssue('tokenRefresh', { reason: 'expired' });
      
      // Verify data exists
      let metrics = metricsCollector.getMetricsSummary();
      expect(metrics.syncMetrics.totalOperations).toBe(1);
      expect(metrics.authenticationMetrics.tokenRefreshFailures).toBe(1);
      
      // Reset metrics
      metricsCollector.resetMetrics();
      
      // Verify reset
      metrics = metricsCollector.getMetricsSummary();
      expect(metrics.syncMetrics.totalOperations).toBe(0);
      expect(metrics.syncMetrics.successfulOperations).toBe(0);
      expect(metrics.syncMetrics.failedOperations).toBe(0);
      expect(metrics.authenticationMetrics.tokenRefreshFailures).toBe(0);
      expect(metrics.authenticationMetrics.reconnectionRequired).toBe(0);
      expect(metrics.authenticationMetrics.lastAuthFailure).toBeNull();
    });
  });
});