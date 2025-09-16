import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../src/services/syncManager.js', () => ({
  default: {
    retryFailedSync: jest.fn()
  }
}));

jest.mock('../../src/models/ReminderSync.js', () => ({
  default: {
    countDocuments: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn()
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

// Mock cron
jest.mock('node-cron', () => ({
  schedule: jest.fn()
}));

// Now import the modules
import ReminderSync from '../../src/models/ReminderSync.js';
import syncManager from '../../src/services/syncManager.js';
import syncRetryJobManager, { 
  startSyncRetryJob, 
  getSyncRetryJobMetrics, 
  getSyncRetryJobHealth,
  forceSyncRetryRun 
} from '../../src/jobs/syncRetryJob.js';

describe('SyncRetryJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset job state
    syncRetryJobManager.isRunning = false;
    syncRetryJobManager.metrics = {
      lastRunTime: null,
      totalProcessed: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalDelayed: 0,
      queueSize: 0,
      oldRecordsCleanedUp: 0,
      errors: []
    };
  });

  describe('processRetryQueue', () => {
    it('should process failed syncs and update metrics', async () => {
      // Mock failed sync records
      const mockFailedSyncs = [
        {
          _id: 'sync1',
          messageId: 'msg1',
          userId: 'user1',
          syncStatus: 'FAILED',
          retryCount: 1,
          lastTriedAt: new Date(Date.now() - 120000) // 2 minutes ago
        },
        {
          _id: 'sync2',
          messageId: 'msg2',
          userId: 'user2',
          syncStatus: 'FAILED',
          retryCount: 0,
          lastTriedAt: null
        }
      ];

      // Mock database queries
      ReminderSync.countDocuments
        .mockResolvedValueOnce(5) // queueSizeBefore
        .mockResolvedValueOnce(3); // queueSizeAfter

      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockFailedSyncs)
      });

      ReminderSync.deleteMany.mockResolvedValue({ deletedCount: 2 });

      // Mock sync manager responses
      syncManager.retryFailedSync
        .mockResolvedValueOnce({ status: 'OK' })
        .mockResolvedValueOnce({ status: 'FAILED', reason: 'Auth error' });

      // Run the job
      await syncRetryJobManager.processRetryQueue();

      // Verify metrics were updated
      const metrics = syncRetryJobManager.getMetrics();
      expect(metrics.totalProcessed).toBe(2);
      expect(metrics.totalSucceeded).toBe(1);
      expect(metrics.totalFailed).toBe(1);
      expect(metrics.queueSize).toBe(3);
      expect(metrics.oldRecordsCleanedUp).toBe(2);
      expect(metrics.lastRunTime).toBeInstanceOf(Date);
    });

    it('should handle errors gracefully and track them', async () => {
      // Mock database error
      ReminderSync.countDocuments.mockRejectedValue(new Error('Database error'));

      // Run the job
      await syncRetryJobManager.processRetryQueue();

      // Verify error was tracked
      const metrics = syncRetryJobManager.getMetrics();
      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0].error).toBe('Database error');
    });

    it('should skip execution if already running', async () => {
      // Set job as running
      syncRetryJobManager.isRunning = true;

      // Run the job
      await syncRetryJobManager.processRetryQueue();

      // Verify no database calls were made
      expect(ReminderSync.countDocuments).not.toHaveBeenCalled();
    });

    it('should process retries with proper delay checking', async () => {
      const recentFailedSync = {
        _id: 'sync1',
        messageId: 'msg1',
        userId: 'user1',
        syncStatus: 'FAILED',
        retryCount: 1,
        lastTriedAt: new Date(Date.now() - 30000) // 30 seconds ago (too recent)
      };

      ReminderSync.countDocuments.mockResolvedValue(1);
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([recentFailedSync])
      });
      ReminderSync.deleteMany.mockResolvedValue({ deletedCount: 0 });

      syncManager.retryFailedSync.mockResolvedValue({ 
        status: 'DELAYED', 
        retryAfter: 30000 
      });

      await syncRetryJobManager.processRetryQueue();

      const metrics = syncRetryJobManager.getMetrics();
      expect(metrics.totalDelayed).toBe(1);
    });
  });

  describe('cleanupOldRecords', () => {
    it('should delete old successful sync records', async () => {
      const mockDeleteResult = { deletedCount: 5 };
      ReminderSync.deleteMany.mockResolvedValue(mockDeleteResult);

      const result = await syncRetryJobManager.cleanupOldRecords('test-correlation');

      expect(result.deletedCount).toBe(5);
      expect(ReminderSync.deleteMany).toHaveBeenCalledWith({
        syncStatus: 'OK',
        updatedAt: { $lt: expect.any(Date) }
      });
    });

    it('should handle cleanup errors', async () => {
      ReminderSync.deleteMany.mockRejectedValue(new Error('Cleanup failed'));

      await expect(
        syncRetryJobManager.cleanupOldRecords('test-correlation')
      ).rejects.toThrow('Cleanup failed');
    });
  });

  describe('getRetryQueueSize', () => {
    it('should return correct queue size', async () => {
      ReminderSync.countDocuments.mockResolvedValue(10);

      const size = await syncRetryJobManager.getRetryQueueSize();

      expect(size).toBe(10);
      expect(ReminderSync.countDocuments).toHaveBeenCalledWith({
        syncStatus: 'FAILED',
        retryCount: { $lt: 3 }
      });
    });

    it('should return 0 on error', async () => {
      ReminderSync.countDocuments.mockRejectedValue(new Error('DB error'));

      const size = await syncRetryJobManager.getRetryQueueSize();

      expect(size).toBe(0);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status for good metrics', async () => {
      ReminderSync.countDocuments
        .mockResolvedValueOnce(5) // queue size
        .mockResolvedValueOnce(2) // old failed count
        .mockResolvedValueOnce(100); // total records

      const health = await syncRetryJobManager.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.healthScore).toBeGreaterThan(80);
      expect(health.queueSize).toBe(5);
      expect(health.oldFailedCount).toBe(2);
    });

    it('should return warning status for moderate issues', async () => {
      ReminderSync.countDocuments
        .mockResolvedValueOnce(60) // large queue size
        .mockResolvedValueOnce(5) // old failed count
        .mockResolvedValueOnce(200); // total records

      const health = await syncRetryJobManager.getHealthStatus();

      expect(health.status).toBe('warning');
      expect(health.healthScore).toBeLessThan(80);
      expect(health.healthScore).toBeGreaterThanOrEqual(60);
    });

    it('should return critical status for severe issues', async () => {
      ReminderSync.countDocuments
        .mockResolvedValueOnce(150) // very large queue size
        .mockResolvedValueOnce(60) // many old failed records
        .mockResolvedValueOnce(300); // total records

      // Add recent errors to worsen health score
      syncRetryJobManager.metrics.errors = [
        { timestamp: new Date(), error: 'Error 1' },
        { timestamp: new Date(), error: 'Error 2' },
        { timestamp: new Date(), error: 'Error 3' },
        { timestamp: new Date(), error: 'Error 4' },
        { timestamp: new Date(), error: 'Error 5' },
        { timestamp: new Date(), error: 'Error 6' }
      ];

      const health = await syncRetryJobManager.getHealthStatus();

      expect(health.status).toBe('critical');
      expect(health.healthScore).toBeLessThan(60);
    });

    it('should handle errors in health check', async () => {
      ReminderSync.countDocuments.mockRejectedValue(new Error('DB error'));

      const health = await syncRetryJobManager.getHealthStatus();

      expect(health.status).toBe('error');
      expect(health.healthScore).toBe(0);
      expect(health.error).toBe('DB error');
    });
  });

  describe('updateMetrics', () => {
    it('should correctly update all metrics', () => {
      const runMetrics = {
        processed: 5,
        succeeded: 3,
        failed: 2,
        delayed: 0,
        queueSizeAfter: 10,
        cleanedUpRecords: 3
      };

      syncRetryJobManager.updateMetrics(runMetrics);

      const metrics = syncRetryJobManager.getMetrics();
      expect(metrics.totalProcessed).toBe(5);
      expect(metrics.totalSucceeded).toBe(3);
      expect(metrics.totalFailed).toBe(2);
      expect(metrics.totalDelayed).toBe(0);
      expect(metrics.queueSize).toBe(10);
      expect(metrics.oldRecordsCleanedUp).toBe(3);
      expect(metrics.lastRunTime).toBeInstanceOf(Date);
    });

    it('should accumulate metrics across multiple runs', () => {
      const runMetrics1 = {
        processed: 3,
        succeeded: 2,
        failed: 1,
        delayed: 0,
        queueSizeAfter: 5,
        cleanedUpRecords: 1
      };

      const runMetrics2 = {
        processed: 4,
        succeeded: 3,
        failed: 1,
        delayed: 0,
        queueSizeAfter: 3,
        cleanedUpRecords: 2
      };

      syncRetryJobManager.updateMetrics(runMetrics1);
      syncRetryJobManager.updateMetrics(runMetrics2);

      const metrics = syncRetryJobManager.getMetrics();
      expect(metrics.totalProcessed).toBe(7);
      expect(metrics.totalSucceeded).toBe(5);
      expect(metrics.totalFailed).toBe(2);
      expect(metrics.queueSize).toBe(3); // Latest value
      expect(metrics.oldRecordsCleanedUp).toBe(3);
    });
  });

  describe('exported functions', () => {
    it('should export startSyncRetryJob function', () => {
      expect(typeof startSyncRetryJob).toBe('function');
    });

    it('should export getSyncRetryJobMetrics function', () => {
      const metrics = getSyncRetryJobMetrics();
      expect(metrics).toHaveProperty('lastRunTime');
      expect(metrics).toHaveProperty('totalProcessed');
      expect(metrics).toHaveProperty('config');
    });

    it('should export getSyncRetryJobHealth function', async () => {
      ReminderSync.countDocuments.mockResolvedValue(0);
      
      const health = await getSyncRetryJobHealth();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('healthScore');
    });

    it('should export forceSyncRetryRun function', async () => {
      ReminderSync.countDocuments.mockResolvedValue(0);
      ReminderSync.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([])
      });
      ReminderSync.deleteMany.mockResolvedValue({ deletedCount: 0 });

      await expect(forceSyncRetryRun()).resolves.not.toThrow();
    });
  });

  describe('error tracking', () => {
    it('should limit error history to 10 entries', async () => {
      // Add 12 errors
      for (let i = 0; i < 12; i++) {
        syncRetryJobManager.metrics.errors.push({
          timestamp: new Date(),
          error: `Error ${i}`,
          correlationId: `corr-${i}`
        });
      }

      // Simulate an error during processing
      ReminderSync.countDocuments.mockRejectedValue(new Error('New error'));
      
      await syncRetryJobManager.processRetryQueue();

      // Should only keep last 10 errors
      expect(syncRetryJobManager.metrics.errors).toHaveLength(10);
      expect(syncRetryJobManager.metrics.errors[9].error).toBe('New error');
    });
  });

  describe('configuration', () => {
    it('should use environment variables for configuration', () => {
      const originalEnv = process.env;
      
      process.env.SYNC_RETRY_CRON_SCHEDULE = '*/10 * * * *';
      process.env.SYNC_RETRY_BATCH_SIZE = '50';
      process.env.SYNC_CLEANUP_AGE_DAYS = '60';
      process.env.SYNC_CLEANUP_BATCH_SIZE = '200';

      // Create new instance to pick up env vars
      const { default: newJobManager } = jest.requireActual('../../src/jobs/syncRetryJob.js');
      
      expect(newJobManager.config.cronSchedule).toBe('*/10 * * * *');
      expect(newJobManager.config.batchSize).toBe(50);
      expect(newJobManager.config.cleanupAgeThreshold).toBe(60);
      expect(newJobManager.config.cleanupBatchSize).toBe(200);

      process.env = originalEnv;
    });

    it('should use default values when env vars are not set', () => {
      const metrics = syncRetryJobManager.getMetrics();
      
      expect(metrics.config.cronSchedule).toBe('*/5 * * * *');
      expect(metrics.config.batchSize).toBe(20);
      expect(metrics.config.cleanupAgeThreshold).toBe(30);
      expect(metrics.config.cleanupBatchSize).toBe(100);
    });
  });
});