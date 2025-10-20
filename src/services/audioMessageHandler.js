import { structuredLogger, generateCorrelationId } from "../helpers/logger.js";
import { transcribeAudioWithWhisper } from "./aiService.js";
import { 
  AudioProcessingError, 
  audioErrorHandler, 
  AUDIO_ERROR_TYPES 
} from "./errorHandling/AudioErrorHandler.js";
import { audioRetryHandler } from "./errorHandling/AudioRetryHandler.js";
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Audio Message Handler Service
 * Coordinates the complete audio processing flow for WhatsApp messages
 */
class AudioMessageHandler {
  constructor() {
    this.correlationId = generateCorrelationId();
    
    // Audio validation constants
    this.AUDIO_VALIDATION_RULES = {
      maxFileSize: 16 * 1024 * 1024, // 16MB (WhatsApp limit)
      maxDuration: 30, // seconds (WhatsApp limit)
      supportedMimeTypes: [
        'audio/ogg; codecs=opus',
        'audio/ogg',
        'audio/mp3',
        'audio/mpeg',
        'audio/wav',
        'audio/aac',
        'audio/m4a'
      ],
      timeoutMs: 30000 // 30 seconds for download + transcription
    };

    structuredLogger.info("AudioMessageHandler initialized", {
      correlationId: this.correlationId,
      service: 'AudioMessageHandler'
    });
  }

  /**
   * Process audio message - main coordination method
   * @param {string} audioId - Media ID from WhatsApp Cloud API
   * @param {object} cloudApiService - CloudApiService instance
   * @returns {Promise<string>} Transcribed text
   */
  async processAudioMessage(audioId, cloudApiService) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    structuredLogger.info("Starting audio message processing", {
      requestId,
      correlationId: this.correlationId,
      audioId,
      service: 'AudioMessageHandler'
    });

    try {
      // Step 1: Download audio media from WhatsApp Cloud API
      const mediaInfo = await this.downloadAudioMedia(audioId, cloudApiService, requestId);
      
      // Step 2: Validate audio file
      await this.validateAudioFile(mediaInfo, requestId);
      
      // Step 3: Transcribe audio using OpenAI Whisper
      const transcription = await this.transcribeAudio(mediaInfo, requestId);
      
      // Step 4: Validate transcription result
      this.validateTranscription(transcription, requestId);

      const duration = Date.now() - startTime;

      structuredLogger.info("Audio message processing completed successfully", {
        requestId,
        correlationId: this.correlationId,
        audioId,
        transcriptionLength: transcription.length,
        duration,
        service: 'AudioMessageHandler'
      });

      return transcription;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      structuredLogger.error("Audio message processing failed", {
        requestId,
        correlationId: this.correlationId,
        audioId,
        error: error.message,
        errorType: error.constructor.name,
        duration,
        service: 'AudioMessageHandler'
      });

      // Handle different types of errors with appropriate user messages
      throw this.handleTranscriptionError(error, { audioId, requestId, duration });
    }
  }

  /**
   * Download audio media from WhatsApp Cloud API with retry logic
   * @param {string} audioId - Media ID
   * @param {object} cloudApiService - CloudApiService instance
   * @param {string} requestId - Request ID for tracking
   * @returns {Promise<object>} Media information with content
   */
  async downloadAudioMedia(audioId, cloudApiService, requestId) {
    const downloadOperation = async () => {
      structuredLogger.info("Downloading audio media", {
        requestId,
        correlationId: this.correlationId,
        audioId,
        service: 'AudioMessageHandler'
      });

      const mediaInfo = await cloudApiService.downloadMedia(audioId);
      
      structuredLogger.info("Audio media downloaded successfully", {
        requestId,
        correlationId: this.correlationId,
        audioId,
        mimeType: mediaInfo.mimeType,
        fileSize: mediaInfo.fileSize,
        service: 'AudioMessageHandler'
      });

      return mediaInfo;
    };

    try {
      return await audioRetryHandler.executeWithRetry(
        downloadOperation,
        'download',
        { 
          audioId, 
          requestId, 
          correlationId: this.correlationId,
          service: 'AudioMessageHandler'
        }
      );
    } catch (error) {
      structuredLogger.error("Failed to download audio media after retries", {
        requestId,
        correlationId: this.correlationId,
        audioId,
        error: error.message,
        service: 'AudioMessageHandler'
      });

      throw error; // Error is already processed by retry handler
    }
  }

  /**
   * Validate audio file according to WhatsApp and processing limits with retry logic
   * @param {object} mediaInfo - Media information object
   * @param {string} requestId - Request ID for tracking
   * @returns {Promise<boolean>} True if valid
   */
  async validateAudioFile(mediaInfo, requestId) {
    const validationOperation = async () => {
      structuredLogger.info("Validating audio file", {
        requestId,
        correlationId: this.correlationId,
        mimeType: mediaInfo.mimeType,
        fileSize: mediaInfo.fileSize,
        service: 'AudioMessageHandler'
      });

      // Check file size
      if (mediaInfo.fileSize > this.AUDIO_VALIDATION_RULES.maxFileSize) {
        throw audioErrorHandler.createError(
          AUDIO_ERROR_TYPES.FILE_TOO_LARGE,
          { 
            requestId, 
            fileSize: mediaInfo.fileSize, 
            maxSize: this.AUDIO_VALIDATION_RULES.maxFileSize 
          }
        );
      }

      // Check MIME type
      const isValidMimeType = this.AUDIO_VALIDATION_RULES.supportedMimeTypes.some(
        supportedType => mediaInfo.mimeType.toLowerCase().includes(supportedType.toLowerCase())
      );

      if (!isValidMimeType) {
        structuredLogger.warn("Unsupported audio format detected", {
          requestId,
          correlationId: this.correlationId,
          mimeType: mediaInfo.mimeType,
          supportedTypes: this.AUDIO_VALIDATION_RULES.supportedMimeTypes,
          service: 'AudioMessageHandler'
        });

        throw audioErrorHandler.createError(
          AUDIO_ERROR_TYPES.UNSUPPORTED_FORMAT,
          { 
            requestId, 
            mimeType: mediaInfo.mimeType,
            supportedTypes: this.AUDIO_VALIDATION_RULES.supportedMimeTypes
          }
        );
      }

      structuredLogger.info("Audio file validation passed", {
        requestId,
        correlationId: this.correlationId,
        mimeType: mediaInfo.mimeType,
        fileSize: mediaInfo.fileSize,
        service: 'AudioMessageHandler'
      });

      return true;
    };

    try {
      return await audioRetryHandler.executeWithRetry(
        validationOperation,
        'validation',
        { 
          requestId, 
          correlationId: this.correlationId,
          mimeType: mediaInfo.mimeType,
          fileSize: mediaInfo.fileSize,
          service: 'AudioMessageHandler'
        }
      );
    } catch (error) {
      if (error instanceof AudioProcessingError) {
        throw error;
      }

      structuredLogger.error("Audio file validation failed after retries", {
        requestId,
        correlationId: this.correlationId,
        error: error.message,
        service: 'AudioMessageHandler'
      });

      throw audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.INVALID_AUDIO_FILE,
        { requestId },
        error
      );
    }
  }

  /**
   * Transcribe audio using OpenAI Whisper with retry logic
   * @param {object} mediaInfo - Media information with content
   * @param {string} requestId - Request ID for tracking
   * @returns {Promise<string>} Transcribed text
   */
  async transcribeAudio(mediaInfo, requestId) {
    let tempFilePath = null;

    const transcriptionOperation = async () => {
      structuredLogger.info("Starting audio transcription", {
        requestId,
        correlationId: this.correlationId,
        mimeType: mediaInfo.mimeType,
        fileSize: mediaInfo.fileSize,
        service: 'AudioMessageHandler'
      });

      // Create a temporary file for the audio content
      tempFilePath = this.createTemporaryAudioUrl(mediaInfo);
      
      const transcription = await transcribeAudioWithWhisper(tempFilePath);

      structuredLogger.info("Audio transcription completed", {
        requestId,
        correlationId: this.correlationId,
        transcriptionLength: transcription ? transcription.length : 0,
        service: 'AudioMessageHandler'
      });

      return transcription;
    };

    try {
      const result = await audioRetryHandler.executeWithRetry(
        transcriptionOperation,
        'transcription',
        { 
          requestId, 
          correlationId: this.correlationId,
          mimeType: mediaInfo.mimeType,
          fileSize: mediaInfo.fileSize,
          service: 'AudioMessageHandler'
        }
      );

      return result;

    } catch (error) {
      structuredLogger.error("Audio transcription failed after retries", {
        requestId,
        correlationId: this.correlationId,
        error: error.message,
        service: 'AudioMessageHandler'
      });

      // Let the error handler classify the error type if not already processed
      if (error instanceof AudioProcessingError) {
        throw error;
      }
      
      throw audioErrorHandler.handleError(error, { 
        requestId, 
        operation: 'transcription',
        correlationId: this.correlationId
      });

    } finally {
      // Clean up temporary file
      if (tempFilePath) {
        this.cleanupTemporaryFile(tempFilePath);
      }
    }
  }

  /**
   * Validate transcription result
   * @param {string} transcription - Transcribed text
   * @param {string} requestId - Request ID for tracking
   * @returns {boolean} True if valid
   */
  validateTranscription(transcription, requestId) {
    if (!transcription || transcription.trim().length === 0) {
      structuredLogger.warn("Empty transcription result", {
        requestId,
        correlationId: this.correlationId,
        service: 'AudioMessageHandler'
      });

      throw audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.TRANSCRIPTION_EMPTY,
        { requestId, transcriptionLength: 0 }
      );
    }

    // Check for minimum meaningful length
    if (transcription.trim().length < 2) {
      structuredLogger.warn("Transcription too short", {
        requestId,
        correlationId: this.correlationId,
        transcriptionLength: transcription.length,
        service: 'AudioMessageHandler'
      });

      throw audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.TRANSCRIPTION_TOO_SHORT,
        { requestId, transcriptionLength: transcription.length }
      );
    }

    return true;
  }

  /**
   * Handle transcription errors and provide user-friendly messages
   * @param {Error} error - Original error
   * @param {object} context - Error context
   * @returns {Error} Processed error with user message
   */
  handleTranscriptionError(error, context) {
    const { audioId, requestId, duration } = context;

    // If it's already an AudioProcessingError, just return it
    if (error instanceof AudioProcessingError) {
      return error;
    }

    // Handle timeout errors
    if (duration > this.AUDIO_VALIDATION_RULES.timeoutMs) {
      return audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.PROCESSING_TIMEOUT,
        { audioId, requestId, duration, timeout: this.AUDIO_VALIDATION_RULES.timeoutMs },
        error
      );
    }

    // Use the comprehensive error handler for classification
    return audioErrorHandler.handleError(error, { audioId, requestId, duration });
  }

  /**
   * Create temporary audio file from media content
   * @param {object} mediaInfo - Media information with content buffer
   * @returns {string} Temporary file path
   */
  createTemporaryAudioUrl(mediaInfo) {

    try {
      // Check if we have content buffer
      if (!mediaInfo.content || !Buffer.isBuffer(mediaInfo.content)) {
        throw audioErrorHandler.createError(
          AUDIO_ERROR_TYPES.INTERNAL_ERROR,
          { error: 'no_content_buffer', mediaInfo: 'missing_content' }
        );
      }

      // Determine file extension from MIME type
      const mimeToExt = {
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp3': '.mp3',
        'audio/wav': '.wav',
        'audio/aac': '.aac',
        'audio/m4a': '.m4a'
      };

      const extension = mimeToExt[mediaInfo.mimeType] || '.ogg';
      
      // Create temporary file
      const tempDir = os.tmpdir();
      const fileName = `audio_${Date.now()}_${Math.random().toString(36).substring(2, 11)}${extension}`;
      const tempFilePath = path.join(tempDir, fileName);

      // Write content to temporary file
      fs.writeFileSync(tempFilePath, mediaInfo.content);

      structuredLogger.info("Temporary audio file created", {
        tempFilePath,
        fileSize: mediaInfo.content.length,
        mimeType: mediaInfo.mimeType,
        service: 'AudioMessageHandler'
      });

      return tempFilePath;

    } catch (error) {
      if (error instanceof AudioProcessingError) {
        throw error;
      }

      throw audioErrorHandler.createError(
        AUDIO_ERROR_TYPES.INTERNAL_ERROR,
        { error: 'temp_file_creation_failed', originalError: error.message }
      );
    }
  }

  /**
   * Clean up temporary audio file
   * @param {string} filePath - Path to temporary file
   */
  cleanupTemporaryFile(filePath) {
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        structuredLogger.info("Temporary audio file cleaned up", {
          filePath,
          service: 'AudioMessageHandler'
        });
      }
    } catch (error) {
      structuredLogger.warn("Failed to cleanup temporary audio file", {
        filePath,
        error: error.message,
        service: 'AudioMessageHandler'
      });
    }
  }

  /**
   * Generate unique request ID for tracking
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `audio_req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get audio processing statistics including retry and circuit breaker status
   * @returns {object} Processing statistics
   */
  getProcessingStats() {
    return {
      service: 'AudioMessageHandler',
      validationRules: this.AUDIO_VALIDATION_RULES,
      correlationId: this.correlationId,
      initialized: true,
      retryStats: audioRetryHandler.getRetryStats(),
      circuitBreakerStatus: audioRetryHandler.getCircuitBreakerStatus(),
      activeRetries: audioRetryHandler.getActiveRetries()
    };
  }

  /**
   * Get circuit breaker status for monitoring
   * @returns {object} Circuit breaker status
   */
  getCircuitBreakerStatus() {
    return audioRetryHandler.getCircuitBreakerStatus();
  }

  /**
   * Get retry statistics for monitoring
   * @returns {object} Retry statistics
   */
  getRetryStats() {
    return audioRetryHandler.getRetryStats();
  }

  /**
   * Reset circuit breaker for specific operation (for manual recovery)
   * @param {string} operationType - Operation type to reset (download, transcription, validation)
   */
  resetCircuitBreaker(operationType) {
    audioRetryHandler.resetCircuitBreaker(operationType);
    
    structuredLogger.info("Circuit breaker manually reset", {
      operationType,
      correlationId: this.correlationId,
      service: 'AudioMessageHandler'
    });
  }

  /**
   * Reset all circuit breakers (for manual recovery)
   */
  resetAllCircuitBreakers() {
    audioRetryHandler.resetAllCircuitBreakers();
    
    structuredLogger.info("All circuit breakers manually reset", {
      correlationId: this.correlationId,
      service: 'AudioMessageHandler'
    });
  }
}

// Export singleton instance
const audioMessageHandler = new AudioMessageHandler();

export { audioMessageHandler };