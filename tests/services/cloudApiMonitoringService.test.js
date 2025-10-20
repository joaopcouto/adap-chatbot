import { CloudApiMonitoringService } from '../../src/services/cloudApiMonitoringService.js';

// Mock the dependencies
jest.mock('../../src/services/cloudApiMetricsCollector.js', () => ({
  cloudApiMetricsCollector: {
    getMetricsSummary: jest.fn(),
    getHealthStatus: jest.fn(),
    resetMetrics: jest.fn()
  }
}));

jest.mock('../../src/services/cloudApiAlertingService.js', () => ({
  cloudApiAlertingService: {
    sendAlerts: jest.fn()
  }
}));

jest.mock('../../src/helpers/logger.js', () => ({
  structuredLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  generateCorrelationId: jest.fn(() => 'test-correlation-id')
}));

describe('CloudApiMonitoringService', () => {
  let monitoringService;
  let mockMetricsCollector;
  let mockAlertingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Import mocked modules
    const { cloudApiMetricsCollector } = await import('../../src/services/cloudApiMetricsCollector.js');
    const { cloudApiAlertingService } = await import('../../src/services/cloudApiAlertingService.js');
    
    mockMetricsCollector = cloudApiMetricsCollector;
    mockAlertingService = cloudApiAlertingService;
    
    // Create new instance for each test
    monitoringService = new CloudApiMonitoringService();
    
    // Clear any existing intervals
    if (monitoringService.healthCheckInterval) {
      clearInterval(monitoringService.healthCheckInterval);
    }
  });

  afterEach(() => {
    // Clean up intervals
    if (monitoringService && monitoringService.healthCheckInterval) {
      clearInterval(monitoringService.healthCheckInterval);
    }
  });

  describe('constructor', () => {
    it('should initialize with default alert thresholds', () => {
      expect(monitoringService.alertThresholds).toEqual({
        errorRate: { warning: 5, critical: 10 },
        responseTime: { warning: 3000, critical: 5000 },
        rateLimitHits: { warning: 5, critical: 10 },
        messageFailureRate: { warning: 2, critical: 5 }
      });
    });

    it('should initialize with empty alert history', () => {
      expect(monitoringService.alertHistory).toEqual([]);
      expect(monitoringService.maxAlertHistory).toBe(100);
    });
  });

  describe('checkAlertConditions', () => {
    it('should detect high error rate critical alert', () => {
      const metrics = {
        requests: { errorRate: 15 },
        performance: { averageDuration: 2000 },
        rateLimiting: { hits: 0 },
        messages: { sent: 100, failed: 5 },
        errors: { authFailures: 0, networkErrors: 0 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('HIGH_ERROR_RATE');
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].value).toBe(15);
    });

    it('should detect high response time warning alert', () => {
      const metrics = {
        requests: { errorRate: 2 },
        performance: { averageDuration: 4000 },
        rateLimiting: { hits: 0 },
        messages: { sent: 100, failed: 1 },
        errors: { authFailures: 0, networkErrors: 0 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('HIGH_RESPONSE_TIME');
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].value).toBe(4000);
    });

    it('should detect rate limit hits', () => {
      const metrics = {
        requests: { errorRate: 2 },
        performance: { averageDuration: 2000 },
        rateLimiting: { hits: 8 },
        messages: { sent: 100, failed: 1 },
        errors: { authFailures: 0, networkErrors: 0 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('RATE_LIMIT_HITS');
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].value).toBe(8);
    });

    it('should detect authentication failures', () => {
      const metrics = {
        requests: { errorRate: 2 },
        performance: { averageDuration: 2000 },
        rateLimiting: { hits: 0 },
        messages: { sent: 100, failed: 1 },
        errors: { authFailures: 3, networkErrors: 0 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('AUTH_FAILURES');
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].value).toBe(3);
    });

    it('should detect multiple alert conditions', () => {
      const metrics = {
        requests: { errorRate: 12 },
        performance: { averageDuration: 6000 },
        rateLimiting: { hits: 15 },
        messages: { sent: 100, failed: 8 },
        errors: { authFailures: 2, networkErrors: 10 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      
      expect(alerts.length).toBeGreaterThan(1);
      
      const alertTypes = alerts.map(alert => alert.type);
      expect(alertTypes).toContain('HIGH_ERROR_RATE');
      expect(alertTypes).toContain('HIGH_RESPONSE_TIME');
      expect(alertTypes).toContain('RATE_LIMIT_HITS');
      expect(alertTypes).toContain('HIGH_MESSAGE_FAILURE_RATE');
      expect(alertTypes).toContain('AUTH_FAILURES');
      expect(alertTypes).toContain('NETWORK_ERRORS');
    });

    it('should return no alerts for healthy metrics', () => {
      const metrics = {
        requests: { errorRate: 1 },
        performance: { averageDuration: 1500 },
        rateLimiting: { hits: 0 },
        messages: { sent: 100, failed: 0 },
        errors: { authFailures: 0, networkErrors: 2 }
      };

      const alerts = monitoringService.checkAlertConditions(metrics);
      expect(alerts).toHaveLength(0);
    });
  });

  describe('performHealthCheck', () => {
    it('should perform successful health check', async () => {
      const mockMetrics = {
        requests: { total: 100, successRate: 95, errorRate: 5 },
        performance: { averageDuration: 2000 },
        rateLimiting: { hits: 0 },
        messages: { sent: 50, failed: 1 },
        errors: { authFailures: 0, networkErrors: 0 }
      };

      const mockHealthStatus = { healthy: true };

      mockMetricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);
      mockMetricsCollector.getHealthStatus.mockReturnValue(mockHealthStatus);

      const healthCheck = await monitoringService.performHealthCheck();

      expect(healthCheck.overall.status).toBe('healthy');
      expect(healthCheck.overall.healthy).toBe(true);
      expect(healthCheck.metrics).toBeDefined();
      expect(healthCheck.alerts).toBeDefined();
      expect(mockAlertingService.sendAlerts).not.toHaveBeenCalled();
    });

    it('should handle health check failure', async () => {
      mockMetricsCollector.getMetricsSummary.mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });

      const healthCheck = await monitoringService.performHealthCheck();

      expect(healthCheck.overall.status).toBe('unhealthy');
      expect(healthCheck.overall.healthy).toBe(false);
      expect(healthCheck.error).toBe('Metrics collection failed');
      expect(healthCheck.alerts).toHaveLength(1);
      expect(healthCheck.alerts[0].type).toBe('HEALTH_CHECK_FAILURE');
      expect(mockAlertingService.sendAlerts).toHaveBeenCalled();
    });

    it('should send alerts when conditions are met', async () => {
      const mockMetrics = {
        requests: { total: 100, successRate: 85, errorRate: 15 },
        performance: { averageDuration: 6000 },
        rateLimiting: { hits: 12 },
        messages: { sent: 50, failed: 8 },
        errors: { authFailures: 0, networkErrors: 0 }
      };

      const mockHealthStatus = { healthy: false };

      mockMetricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);
      mockMetricsCollector.getHealthStatus.mockReturnValue(mockHealthStatus);

      const healthCheck = await monitoringService.performHealthCheck();

      expect(healthCheck.alerts.length).toBeGreaterThan(0);
      expect(mockAlertingService.sendAlerts).toHaveBeenCalledWith(
        healthCheck.alerts,
        expect.any(String)
      );
    });
  });

  describe('getDashboardData', () => {
    it('should return comprehensive dashboard data', () => {
      const mockMetrics = {
        summary: { uptime: 3600000 },
        requests: { total: 100, successful: 95, failed: 5, successRate: 95, errorRate: 5 },
        performance: { averageDuration: 2000, p95Duration: 3000, minDuration: 500, maxDuration: 5000 },
        errors: { total: 5, rateLimits: 1, authFailures: 0, networkErrors: 2 },
        messages: { sent: 50, delivered: 48, failed: 2, deliveryRate: 96 },
        webhooks: { received: 20, processed: 19, failed: 1 },
        rateLimiting: { hits: 1, totalWaitTime: 60, averageWaitTime: 60 }
      };

      const mockHealthStatus = { healthy: true };

      mockMetricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);
      mockMetricsCollector.getHealthStatus.mockReturnValue(mockHealthStatus);

      const dashboardData = monitoringService.getDashboardData();

      expect(dashboardData.overview.status).toBe('healthy');
      expect(dashboardData.overview.totalRequests).toBe(100);
      expect(dashboardData.performance.averageResponseTime).toBe(2000);
      expect(dashboardData.requests.total).toBe(100);
      expect(dashboardData.errors.total).toBe(5);
      expect(dashboardData.messages.sent).toBe(50);
      expect(dashboardData.alerts).toBeDefined();
    });
  });

  describe('updateAlertThresholds', () => {
    it('should update alert thresholds', () => {
      const newThresholds = {
        errorRate: { warning: 3, critical: 8 },
        responseTime: { warning: 2000, critical: 4000 }
      };

      monitoringService.updateAlertThresholds(newThresholds);

      expect(monitoringService.alertThresholds.errorRate.warning).toBe(3);
      expect(monitoringService.alertThresholds.errorRate.critical).toBe(8);
      expect(monitoringService.alertThresholds.responseTime.warning).toBe(2000);
      expect(monitoringService.alertThresholds.responseTime.critical).toBe(4000);
      
      // Should preserve existing thresholds not updated
      expect(monitoringService.alertThresholds.rateLimitHits.warning).toBe(5);
    });
  });

  describe('generateReport', () => {
    it('should generate comprehensive monitoring report', () => {
      const mockMetrics = {
        requests: { total: 100, successRate: 95, errorRate: 5 },
        performance: { averageDuration: 2000 },
        messages: { sent: 50, deliveryRate: 96 },
        rateLimiting: { hits: 1 }
      };

      mockMetricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);

      const report = monitoringService.generateReport('day');

      expect(report.reportId).toBeDefined();
      expect(report.period).toBe('day');
      expect(report.summary.totalRequests).toBe(100);
      expect(report.summary.successRate).toBe(95);
      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should generate recommendations based on metrics', () => {
      const mockMetrics = {
        requests: { total: 100, successRate: 90, errorRate: 10 },
        performance: { averageDuration: 4000 },
        messages: { sent: 50, deliveryRate: 90 },
        rateLimiting: { hits: 8 }
      };

      mockMetricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);

      const report = monitoringService.generateReport('day');

      expect(report.recommendations.length).toBeGreaterThan(0);
      
      const recommendationTypes = report.recommendations.map(rec => rec.type);
      expect(recommendationTypes).toContain('ERROR_RATE');
      expect(recommendationTypes).toContain('PERFORMANCE');
      expect(recommendationTypes).toContain('RATE_LIMITING');
      expect(recommendationTypes).toContain('MESSAGE_DELIVERY');
    });
  });

  describe('resetMonitoringData', () => {
    it('should reset all monitoring data', () => {
      // Add some alert history
      monitoringService.alertHistory = [
        { type: 'TEST_ALERT', severity: 'warning' }
      ];
      monitoringService.lastHealthCheck = { status: 'healthy' };

      monitoringService.resetMonitoringData();

      expect(monitoringService.alertHistory).toHaveLength(0);
      expect(monitoringService.lastHealthCheck).toBeNull();
      expect(mockMetricsCollector.resetMetrics).toHaveBeenCalled();
    });
  });
});