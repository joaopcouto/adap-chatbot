import { AUDIO_CONSTANTS } from './constants.js';
import { structuredLogger } from '../helpers/logger.js';
import path from 'path';

/**
 * Audio processing utility functions
 */

/**
 * Validate audio file based on media info
 * @param {Object} mediaInfo - Media information from WhatsApp Cloud API
 * @param {string} mediaInfo.id - Media ID
 * @param {string} mediaInfo.mime_type - MIME type of the audio file
 * @param {number} mediaInfo.file_size - File size in bytes
 * @param {string} [mediaInfo.filename] - Original filename (optional)
 * @returns {Object} Validation result with isValid boolean and error details
 */
export function validateAudioFile(mediaInfo) {
  const validation = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // Validate media info structure
  if (!mediaInfo || typeof mediaInfo !== 'object') {
    validation.isValid = false;
    validation.errors.push({
      type: AUDIO_CONSTANTS.ERROR_TYPES.INVALID_MEDIA_ID,
      message: 'Invalid media information provided'
    });
    return validation;
  }

  // Validate media ID
  if (!mediaInfo.id || typeof mediaInfo.id !== 'string' || mediaInfo.id.trim() === '') {
    validation.isValid = false;
    validation.errors.push({
      type: AUDIO_CONSTANTS.ERROR_TYPES.INVALID_MEDIA_ID,
      message: 'Media ID is required and must be a non-empty string'
    });
  }

  // Validate MIME type
  if (!mediaInfo.mime_type) {
    validation.isValid = false;
    validation.errors.push({
      type: AUDIO_CONSTANTS.ERROR_TYPES.UNSUPPORTED_FORMAT,
      message: 'MIME type is required'
    });
  } else if (!isValidMimeType(mediaInfo.mime_type)) {
    validation.isValid = false;
    validation.errors.push({
      type: AUDIO_CONSTANTS.ERROR_TYPES.UNSUPPORTED_FORMAT,
      message: `Unsupported MIME type: ${mediaInfo.mime_type}`
    });
  }

  // Validate file size
  if (typeof mediaInfo.file_size !== 'number' || mediaInfo.file_size <= 0) {
    validation.isValid = false;
    validation.errors.push({
      type: AUDIO_CONSTANTS.ERROR_TYPES.FILE_TOO_SMALL,
      message: 'File size must be a positive number'
    });
  } else {
    if (mediaInfo.file_size < AUDIO_CONSTANTS.MIN_FILE_SIZE) {
      validation.isValid = false;
      validation.errors.push({
        type: AUDIO_CONSTANTS.ERROR_TYPES.FILE_TOO_SMALL,
        message: `File too small: ${mediaInfo.file_size} bytes (minimum: ${AUDIO_CONSTANTS.MIN_FILE_SIZE} bytes)`
      });
    }

    if (mediaInfo.file_size > AUDIO_CONSTANTS.MAX_FILE_SIZE) {
      validation.isValid = false;
      validation.errors.push({
        type: AUDIO_CONSTANTS.ERROR_TYPES.FILE_TOO_LARGE,
        message: `File too large: ${mediaInfo.file_size} bytes (maximum: ${AUDIO_CONSTANTS.MAX_FILE_SIZE} bytes)`
      });
    }
  }

  // Validate filename extension if provided
  if (mediaInfo.filename) {
    const extension = path.extname(mediaInfo.filename).toLowerCase();
    if (extension && !isValidFileExtension(extension)) {
      validation.warnings.push({
        type: AUDIO_CONSTANTS.ERROR_TYPES.UNSUPPORTED_FORMAT,
        message: `Potentially unsupported file extension: ${extension}`
      });
    }
  }

  // Log validation result
  if (!validation.isValid) {
    structuredLogger.warn('Audio file validation failed', {
      mediaId: mediaInfo.id,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
      errors: validation.errors,
      warnings: validation.warnings
    });
  } else if (validation.warnings.length > 0) {
    structuredLogger.info('Audio file validation passed with warnings', {
      mediaId: mediaInfo.id,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
      warnings: validation.warnings
    });
  }

  return validation;
}

/**
 * Check if MIME type is supported for audio processing
 * @param {string} mimeType - MIME type to validate
 * @returns {boolean} True if MIME type is supported
 */
export function isValidMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') {
    return false;
  }

  const normalizedMimeType = mimeType.toLowerCase().trim();
  
  // Check exact matches first
  if (AUDIO_CONSTANTS.SUPPORTED_MIME_TYPES.includes(normalizedMimeType)) {
    return true;
  }

  // Check base MIME types (without codecs)
  const baseMimeType = normalizedMimeType.split(';')[0].trim();
  return AUDIO_CONSTANTS.SUPPORTED_MIME_TYPES.some(supportedType => 
    supportedType.split(';')[0].trim() === baseMimeType
  );
}

/**
 * Check if file extension is supported
 * @param {string} extension - File extension (with or without dot)
 * @returns {boolean} True if extension is supported
 */
export function isValidFileExtension(extension) {
  if (!extension || typeof extension !== 'string') {
    return false;
  }

  const normalizedExtension = extension.toLowerCase().trim();
  const extensionWithDot = normalizedExtension.startsWith('.') ? normalizedExtension : `.${normalizedExtension}`;
  
  return AUDIO_CONSTANTS.SUPPORTED_EXTENSIONS.includes(extensionWithDot);
}

/**
 * Get user-friendly error message for error type
 * @param {string} errorType - Error type from AUDIO_CONSTANTS.ERROR_TYPES
 * @param {Object} [context] - Additional context for the error
 * @returns {string} User-friendly error message in Portuguese
 */
export function getErrorMessage(errorType, context = {}) {
  const baseMessage = AUDIO_CONSTANTS.ERROR_MESSAGES[errorType];
  
  if (!baseMessage) {
    structuredLogger.warn('Unknown audio error type', { errorType, context });
    return AUDIO_CONSTANTS.ERROR_MESSAGES.SERVICE_UNAVAILABLE;
  }

  // Add context-specific information if available
  switch (errorType) {
    case AUDIO_CONSTANTS.ERROR_TYPES.FILE_TOO_LARGE:
      if (context.fileSize) {
        const sizeMB = Math.round(context.fileSize / (1024 * 1024) * 100) / 100;
        const maxSizeMB = Math.round(AUDIO_CONSTANTS.MAX_FILE_SIZE / (1024 * 1024));
        return `Seu áudio tem ${sizeMB}MB, mas o limite é ${maxSizeMB}MB. Envie um áudio menor.`;
      }
      break;
    case AUDIO_CONSTANTS.ERROR_TYPES.DURATION_TOO_LONG:
      if (context.duration) {
        return `Seu áudio tem ${context.duration} segundos, mas o limite é ${AUDIO_CONSTANTS.MAX_DURATION_SECONDS} segundos.`;
      }
      break;
    case AUDIO_CONSTANTS.ERROR_TYPES.UNSUPPORTED_FORMAT:
      if (context.mimeType) {
        return `Formato ${context.mimeType} não suportado. Use MP3, WAV, OGG ou AAC.`;
      }
      break;
  }

  return baseMessage;
}

/**
 * Create audio processing context object
 * @param {string} messageId - WhatsApp message ID
 * @param {string} userId - User ID
 * @param {string} audioId - Audio media ID
 * @param {Object} mediaInfo - Media information
 * @returns {Object} Audio processing context
 */
export function createAudioProcessingContext(messageId, userId, audioId, mediaInfo) {
  return {
    messageId,
    userId,
    audioId,
    mediaInfo: {
      id: mediaInfo.id,
      mimeType: mediaInfo.mime_type,
      fileSize: mediaInfo.file_size,
      filename: mediaInfo.filename || null
    },
    transcription: null,
    processingStartTime: new Date(),
    processingEndTime: null,
    status: AUDIO_CONSTANTS.PROCESSING_STATUS.PENDING,
    errors: [],
    retryCount: 0
  };
}

/**
 * Update audio processing context status
 * @param {Object} context - Audio processing context
 * @param {string} status - New status from AUDIO_CONSTANTS.PROCESSING_STATUS
 * @param {Object} [additionalData] - Additional data to merge into context
 * @returns {Object} Updated context
 */
export function updateProcessingStatus(context, status, additionalData = {}) {
  const updatedContext = {
    ...context,
    ...additionalData,
    status,
    lastUpdated: new Date()
  };

  if (status === AUDIO_CONSTANTS.PROCESSING_STATUS.COMPLETED || 
      status === AUDIO_CONSTANTS.PROCESSING_STATUS.FAILED) {
    updatedContext.processingEndTime = new Date();
    updatedContext.processingDuration = updatedContext.processingEndTime - updatedContext.processingStartTime;
  }

  structuredLogger.info('Audio processing status updated', {
    messageId: context.messageId,
    audioId: context.audioId,
    oldStatus: context.status,
    newStatus: status,
    processingDuration: updatedContext.processingDuration
  });

  return updatedContext;
}

/**
 * Calculate retry delay with exponential backoff
 * @param {number} retryCount - Current retry attempt (0-based)
 * @param {number} [baseDelay] - Base delay in milliseconds
 * @param {number} [maxDelay] - Maximum delay in milliseconds
 * @param {number} [multiplier] - Backoff multiplier
 * @returns {number} Delay in milliseconds
 */
export function calculateRetryDelay(
  retryCount, 
  baseDelay = AUDIO_CONSTANTS.RETRY_CONFIG.BASE_DELAY_MS,
  maxDelay = AUDIO_CONSTANTS.RETRY_CONFIG.MAX_DELAY_MS,
  multiplier = AUDIO_CONSTANTS.RETRY_CONFIG.BACKOFF_MULTIPLIER
) {
  const delay = baseDelay * Math.pow(multiplier, retryCount);
  return Math.min(delay, maxDelay);
}

/**
 * Check if retry should be attempted
 * @param {string} operation - Operation type ('download' or 'transcription')
 * @param {number} retryCount - Current retry count
 * @returns {boolean} True if retry should be attempted
 */
export function shouldRetry(operation, retryCount) {
  switch (operation) {
    case 'download':
      return retryCount < AUDIO_CONSTANTS.RETRY_CONFIG.MAX_DOWNLOAD_RETRIES;
    case 'transcription':
      return retryCount < AUDIO_CONSTANTS.RETRY_CONFIG.MAX_TRANSCRIPTION_RETRIES;
    default:
      return false;
  }
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration for display
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1:30")
 */
export function formatDuration(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Validate audio processing configuration
 * @param {Object} config - Audio processing configuration
 * @returns {Object} Validation result
 */
export function validateAudioConfig(config) {
  const validation = {
    isValid: true,
    errors: []
  };

  if (!config || typeof config !== 'object') {
    validation.isValid = false;
    validation.errors.push('Audio configuration must be an object');
    return validation;
  }

  // Validate required fields
  const requiredFields = ['maxFileSize', 'processingTimeout', 'tempDir'];
  for (const field of requiredFields) {
    if (!(field in config)) {
      validation.isValid = false;
      validation.errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate numeric fields
  if (typeof config.maxFileSize === 'number') {
    if (config.maxFileSize < AUDIO_CONSTANTS.MIN_FILE_SIZE || config.maxFileSize > 50 * 1024 * 1024) {
      validation.isValid = false;
      validation.errors.push('maxFileSize must be between 1KB and 50MB');
    }
  }

  if (typeof config.processingTimeout === 'number') {
    if (config.processingTimeout < 5000 || config.processingTimeout > 120000) {
      validation.isValid = false;
      validation.errors.push('processingTimeout must be between 5 seconds and 2 minutes');
    }
  }

  return validation;
}