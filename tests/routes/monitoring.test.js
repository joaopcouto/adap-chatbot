import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock dependencies before importing
jest.mock('../../src/jobs/syncRetryJob.js', () => ({
  getSyncRetryJobMetrics: jest.fn(),
  getSyncRetryJobHealth: jest.fn(),
  forceSyncRetryRun: jest.fn()
}));

jest.mock('../../src/models/ReminderSync.js', () => ({
  default: {
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn()
  }
}));

jest.mock('../../src/helpers/logger.js', () => ({
  devLog: jest.fn(),
  structuredLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  generateCorrelationId: jest.fn(() => 'test-correlation-id')
}));

// Now import the modules
import monitoringRouter from '../../src/routes/monitoring.js';
import ReminderSync from '../../src/models/ReminderSync.js';
import { 
  getSyncRetryJobMetrics, 
  getSyncRetryJobHealth, 
  forceSyncRetryRun 
} from '../../src/jobs/syncRetryJob.js';

describe('Monitoring Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/monitoring', monitoringRouter);
    jest.clearAllMocks();
  });

  describe('GET /api/monitoring/sync-retry/metrics', () => {
    it('should return sync retry job metrics', async () => {
      const mockMetrics = {
        lastRunTime: new Date(),
        totalProcessed: 100,
        totalSucceeded: 85,
        totalFailed: 15,
        totalDelayed: 5,
        queueSize: 10,
        oldRecordsCleanedUp: 20,
        errors: [],
        isRunning: false,
        config: {
          cronSchedule: '*/5 * * * *',
          batchSize: 20
        }
      };

      getSyncRetryJobMetrics.mockReturnValue(mockMetrics);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/metrics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockMetrics);
      expect(response.body.correlationId).toBe('test-correlation-id');
    });

    it('should handle errors when fetching metrics', async () => {
      getSyncRetryJobMetrics.mockImplementation(() => {
        throw new Error('Metrics error');
      });

      const response = await request(app)
        .get('/api/monitoring/sync-retry/metrics')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch metrics');
    });
  });

  describe('GET /api/monitoring/sync-retry/health', () => {
    it('should return healthy status with 200', async () => {
      const mockHealth = {
        status: 'healthy',
        healthScore: 95,
        queueSize: 5,
        oldFailedCount: 2,
        totalSyncRecords: 100,
        recentErrorCount: 0,
        lastRunTime: new Date(),
        isRunning: false
      };

      getSyncRetryJobHealth.mockResolvedValue(mockHealth);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockHealth);
    });

    it('should return warning status with 200', async () => {
      const mockHealth = {
        status: 'warning',
        healthScore: 70,
        queueSize: 25,
        oldFailedCount: 10
      };

      getSyncRetryJobHealth.mockResolvedValue(mockHealth);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(200);

      expect(response.body.data.status).toBe('warning');
    });

    it('should return critical status with 503', async () => {
      const mockHealth = {
        status: 'critical',
        healthScore: 30,
        queueSize: 100,
        oldFailedCount: 50
      };

      getSyncRetryJobHealth.mockResolvedValue(mockHealth);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(503);

      expect(response.body.data.status).toBe('critical');
    });

    it('should return error status with 500', async () => {
      const mockHealth = {
        status: 'error',
        healthScore: 0,
        error: 'Database connection failed'
      };

      getSyncRetryJobHealth.mockResolvedValue(mockHealth);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(500);

      expect(response.body.data.status).toBe('error');
    });

    it('should handle exceptions during health check', async () => {
      getSyncRetryJobHealth.mockRejectedValue(new Error('Health check failed'));

      const response = await request(app)
        .get('/api/monitoring/sync-retry/health')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch health status');
    });
  });

  describe('GET /api/monitoring/sync-retry/queue-stats', () => {
    it('should return detailed queue statistics', async () => {
      // Mock database queries
      ReminderSync.countDocuments
        .mockResolvedValueOnce(150) // total
        .mockResolvedValueOnce(10)  // queued
        .mockResolvedValueOnce(120) // ok
        .mockResolvedValueOnce(20)  // failed
        .mockResolvedValueOnce(15)  // retryable failed
        .mockResolvedValueOnce(5)   // permanent failed
        .mockResolvedValueOnce(3);  // old failed

      ReminderSync.aggregate.mockResolvedValue([
        { _id: 'OK', count: 50 },
        { _id: 'FAILED', count: 5 },
        { _id: 'QUEUED', count: 2 }
      ]);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/queue-stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total.records).toBe(150);
      expect(response.body.data.total.successful).toBe(120);
      expect(response.body.data.total.failed).toBe(20);
      expect(response.body.data.recent24Hours.ok).toBe(50);
      expect(response.body.data.percentages.successRate).toBe('80.00');
    });

    it('should handle database errors', async () => {
      ReminderSync.countDocuments.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .get('/api/monitoring/sync-retry/queue-stats')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch queue statistics');
    });
  });

  describe('POST /api/monitoring/sync-retry/force-run', () => {
    it('should trigger manual sync retry job', async () => {
      forceSyncRetryRun.mockResolvedValue();

      const response = await request(app)
        .post('/api/monitoring/sync-retry/force-run')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Sync retry job triggered successfully');
      expect(forceSyncRetryRun).toHaveBeenCalled();
    });

    it('should handle errors during manual trigger', async () => {
      forceSyncRetryRun.mockImplementation(() => {
        throw new Error('Trigger failed');
      });

      const response = await request(app)
        .post('/api/monitoring/sync-retry/force-run')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to trigger sync retry job');
    });
  });

  describe('GET /api/monitoring/sync-retry/failed-records', () => {
    it('should return paginated failed records', async () => {
      const mockRecords = [
        {
          messageId: 'msg1',
          userId: 'user1',
          syncStatus: 'FAILED',
          lastError: 'Auth error',
          retryCount: 2,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          messageId: 'msg2',
          userId: 'user2',
          syncStatus: 'FAILED',
          lastError: 'Network error',
          retryCount: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockRecords)
      });

      ReminderSync.countDocuments.mockResolvedValue(25);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/failed-records?page=1&limit=20')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.records).toHaveLength(2);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.totalCount).toBe(25);
      expect(response.body.data.pagination.totalPages).toBe(2);
    });

    it('should handle pagination parameters correctly', async () => {
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      });

      ReminderSync.countDocuments.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/failed-records?page=2&limit=10')
        .expect(200);

      expect(ReminderSync.find().skip).toHaveBeenCalledWith(10);
      expect(ReminderSync.find().limit).toHaveBeenCalledWith(10);
    });

    it('should limit maximum records per page', async () => {
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      });

      ReminderSync.countDocuments.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/failed-records?limit=200')
        .expect(200);

      // Should be limited to 100
      expect(ReminderSync.find().limit).toHaveBeenCalledWith(100);
    });

    it('should handle database errors', async () => {
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockRejectedValue(new Error('DB error'))
      });

      const response = await request(app)
        .get('/api/monitoring/sync-retry/failed-records')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch failed records');
    });
  });

  describe('Request validation and security', () => {
    it('should include correlation ID in all responses', async () => {
      getSyncRetryJobMetrics.mockReturnValue({});

      const response = await request(app)
        .get('/api/monitoring/sync-retry/metrics')
        .expect(200);

      expect(response.body.correlationId).toBe('test-correlation-id');
    });

    it('should handle missing query parameters gracefully', async () => {
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      });

      ReminderSync.countDocuments.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/monitoring/sync-retry/failed-records')
        .expect(200);

      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(20);
    });
  });
});