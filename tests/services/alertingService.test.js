import { jest } from '@jest/globals';
import alertingService from '../../src/services/alertingService.js';
import metricsCollector from '../../src/services/metricsCollector.js';

// Mock the metrics collector
jest.mock('../../src/services/metricsCollector.js', () => ({
  default: {
    getMetricsSummary: jest.fn(),
    updateQueueMetrics: jest.fn()
  }
}));

describe('AlertingService', () => {
  beforeEach(() => {
    // Reset alert states before each test
    alertingService.resetAlertStates();
    jest.clearAllMocks();
  });

  describe('checkAndTriggerAlerts', () => {
    it('should not trigger alerts with healthy metrics', async () => {
      // Mock healthy metrics
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 100,
          successfulOperations: 95,
          failedOperations: 5,
          successRate: 95,
          failureRate: 5
        },
        authenticationMetrics: {
          authFailureRate: 2,
          tokenRefreshFailures: 2,
          reconnectionRequired: 0,
          lastAuthFailure: null
        },
        queueMetrics: {
          currentSize: 10,
          maxSize: 20,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 1500
          }
        },
        errorDistribution: {
          AUTH_ERROR: 2,
          RATE_LIMIT: 1,
          SERVER_ERROR: 2,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      });

      const result = await alertingService.checkAndTriggerAlerts();

      expect(result.alertsTriggered).toBe(0);
      expect(result.alerts).toHaveLength(0);
    });

    it('should trigger high error rate alert', async () => {
      // Mock metrics with high error rate
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 100,
          successfulOperations: 70,
          failedOperations: 30,
          successRate: 70,
          failureRate: 30
        },
        authenticationMetrics: {
          authFailureRate: 5,
          tokenRefreshFailures: 5,
          reconnectionRequired: 0,
          lastAuthFailure: new Date()
        },
        queueMetrics: {
          currentSize: 20,
          maxSize: 30,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 2000
          }
        },
        errorDistribution: {
          AUTH_ERROR: 10,
          RATE_LIMIT: 5,
          SERVER_ERROR: 10,
          CLIENT_ERROR: 3,
          NETWORK_ERROR: 2,
          UNKNOWN_ERROR: 0
        }
      });

      const result = await alertingService.checkAndTriggerAlerts();

      expect(result.alertsTriggered).toBeGreaterThan(0);
      expect(result.alerts.some(alert => alert.type === 'HIGH_ERROR_RATE')).toBe(true);
    });

    it('should trigger high auth failure rate alert', async () => {
      // Mock metrics with high auth failure rate
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 100,
          successfulOperations: 85,
          failedOperations: 15,
          successRate: 85,
          failureRate: 15
        },
        authenticationMetrics: {
          authFailureRate: 15, // High auth failure rate
          tokenRefreshFailures: 10,
          reconnectionRequired: 5,
          lastAuthFailure: new Date()
        },
        queueMetrics: {
          currentSize: 25,
          maxSize: 40,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 2500
          }
        },
        errorDistribution: {
          AUTH_ERROR: 15,
          RATE_LIMIT: 0,
          SERVER_ERROR: 0,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      });

      const result = await alertingService.checkAndTriggerAlerts();

      expect(result.alertsTriggered).toBeGreaterThan(0);
      expect(result.alerts.some(alert => alert.type === 'HIGH_AUTH_FAILURE_RATE')).toBe(true);
    });

    it('should trigger high queue size alert', async () => {
      // Mock metrics with high queue size
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 50,
          successfulOperations: 45,
          failedOperations: 5,
          successRate: 90,
          failureRate: 10
        },
        authenticationMetrics: {
          authFailureRate: 3,
          tokenRefreshFailures: 1,
          reconnectionRequired: 0,
          lastAuthFailure: null
        },
        queueMetrics: {
          currentSize: 150, // High queue size
          maxSize: 200,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 1800
          }
        },
        errorDistribution: {
          AUTH_ERROR: 2,
          RATE_LIMIT: 1,
          SERVER_ERROR: 2,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      });

      const result = await alertingService.checkAndTriggerAlerts();

      expect(result.alertsTriggered).toBeGreaterThan(0);
      expect(result.alerts.some(alert => alert.type === 'HIGH_QUEUE_SIZE')).toBe(true);
    });

    it('should trigger slow performance alert', async () => {
      // Mock metrics with slow performance
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 50,
          successfulOperations: 45,
          failedOperations: 5,
          successRate: 90,
          failureRate: 10
        },
        authenticationMetrics: {
          authFailureRate: 3,
          tokenRefreshFailures: 1,
          reconnectionRequired: 0,
          lastAuthFailure: null
        },
        queueMetrics: {
          currentSize: 30,
          maxSize: 50,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 8000, // Slow average response time
            slowest: {
              operation: 'createEvent',
              duration: 12000,
              timestamp: new Date()
            }
          },
          createEvent: { average: 8500, count: 20 },
          updateEvent: { average: 7500, count: 15 },
          searchEvent: { average: 6000, count: 10 },
          tokenRefresh: { average: 9000, count: 5 }
        },
        errorDistribution: {
          AUTH_ERROR: 2,
          RATE_LIMIT: 1,
          SERVER_ERROR: 2,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      });

      const result = await alertingService.checkAndTriggerAlerts();

      expect(result.alertsTriggered).toBeGreaterThan(0);
      expect(result.alerts.some(alert => alert.type === 'SLOW_PERFORMANCE')).toBe(true);
    });

    it('should not trigger duplicate alerts during cooldown period', async () => {
      // Mock metrics with high error rate
      const mockMetrics = {
        syncMetrics: {
          totalOperations: 100,
          successfulOperations: 60,
          failedOperations: 40,
          successRate: 60,
          failureRate: 40
        },
        authenticationMetrics: {
          authFailureRate: 5,
          tokenRefreshFailures: 5,
          reconnectionRequired: 0,
          lastAuthFailure: new Date()
        },
        queueMetrics: {
          currentSize: 20,
          maxSize: 30,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 2000
          }
        },
        errorDistribution: {
          AUTH_ERROR: 15,
          RATE_LIMIT: 10,
          SERVER_ERROR: 15,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      };

      metricsCollector.getMetricsSummary.mockReturnValue(mockMetrics);

      // First check should trigger alert
      const result1 = await alertingService.checkAndTriggerAlerts();
      expect(result1.alertsTriggered).toBeGreaterThan(0);

      // Second check immediately after should not trigger (cooldown)
      const result2 = await alertingService.checkAndTriggerAlerts();
      expect(result2.alertsTriggered).toBe(0);
    });
  });

  describe('getAlertStatus', () => {
    it('should return current alert status and configuration', () => {
      const status = alertingService.getAlertStatus();

      expect(status).toHaveProperty('alertState');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('lastCheck');
      expect(status.alertState).toHaveProperty('highErrorRate');
      expect(status.alertState).toHaveProperty('highAuthFailureRate');
      expect(status.alertState).toHaveProperty('highQueueSize');
      expect(status.alertState).toHaveProperty('slowPerformance');
    });
  });

  describe('resetAlertStates', () => {
    it('should reset all alert states', async () => {
      // First trigger some alerts
      metricsCollector.getMetricsSummary.mockReturnValue({
        syncMetrics: {
          totalOperations: 100,
          successfulOperations: 50,
          failedOperations: 50,
          successRate: 50,
          failureRate: 50
        },
        authenticationMetrics: {
          authFailureRate: 20,
          tokenRefreshFailures: 15,
          reconnectionRequired: 5,
          lastAuthFailure: new Date()
        },
        queueMetrics: {
          currentSize: 200,
          maxSize: 250,
          lastUpdated: new Date()
        },
        responseTimeMetrics: {
          overall: {
            average: 10000
          }
        },
        errorDistribution: {
          AUTH_ERROR: 25,
          RATE_LIMIT: 10,
          SERVER_ERROR: 15,
          CLIENT_ERROR: 0,
          NETWORK_ERROR: 0,
          UNKNOWN_ERROR: 0
        }
      });

      await alertingService.checkAndTriggerAlerts();

      // Verify alerts are active
      let status = alertingService.getAlertStatus();
      expect(Object.values(status.alertState).some(state => state.active)).toBe(true);

      // Reset alert states
      alertingService.resetAlertStates();

      // Verify all alerts are cleared
      status = alertingService.getAlertStatus();
      Object.values(status.alertState).forEach(state => {
        expect(state.active).toBe(false);
        expect(state.count).toBe(0);
        expect(state.lastTriggered).toBeNull();
      });
    });
  });
});