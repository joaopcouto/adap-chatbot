import mongoose from "mongoose";
import securityUtils from "../utils/securityUtils.js";

const userGoogleIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    connected: {
      type: Boolean,
      default: false
    },
    calendarSyncEnabled: {
      type: Boolean,
      default: false
    },
    calendarId: {
      type: String,
      default: null
    },
    accessToken: {
      type: String,
      default: null
    },
    refreshToken: {
      type: String,
      default: null
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    },
    timezone: {
      type: String,
      default: 'America/Sao_Paulo'
    },
    defaultReminders: [{
      type: Number // Minutes before event
    }],
    notifications: {
      type: Map,
      of: [Date],
      default: new Map()
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient queries
userGoogleIntegrationSchema.index({ userId: 1 });

// Method to encrypt refresh token before saving
userGoogleIntegrationSchema.methods.encryptRefreshToken = function(token, correlationId = null) {
  if (!token) return null;
  
  try {
    return securityUtils.encrypt(token, correlationId);
  } catch (error) {
    securityUtils.logSecurityEvent('TOKEN_ENCRYPTION_FAILED', {
      severity: 'ERROR',
      userId: this.userId,
      correlationId,
      details: 'Failed to encrypt refresh token'
    });
    throw error;
  }
};

// Method to decrypt refresh token after retrieval
userGoogleIntegrationSchema.methods.decryptRefreshToken = function(encryptedToken, correlationId = null) {
  if (!encryptedToken) return null;
  
  try {
    return securityUtils.decrypt(encryptedToken, correlationId);
  } catch (error) {
    securityUtils.logSecurityEvent('TOKEN_DECRYPTION_FAILED', {
      severity: 'ERROR',
      userId: this.userId,
      correlationId,
      details: 'Failed to decrypt refresh token'
    });
    return null;
  }
};

// Pre-save hook to encrypt refresh token
userGoogleIntegrationSchema.pre('save', function(next) {
  if (this.isModified('refreshToken') && this.refreshToken) {
    this.refreshToken = this.encryptRefreshToken(this.refreshToken);
  }
  next();
});

// Method to get decrypted refresh token
userGoogleIntegrationSchema.methods.getDecryptedRefreshToken = function() {
  return this.decryptRefreshToken(this.refreshToken);
};

// Method to check if user has valid Google integration
userGoogleIntegrationSchema.methods.hasValidIntegration = function() {
  return this.connected && 
         this.calendarSyncEnabled && 
         this.accessToken && 
         this.refreshToken &&
         this.tokenExpiresAt &&
         this.tokenExpiresAt > new Date();
};

// Method to clear all Google tokens and disconnect
userGoogleIntegrationSchema.methods.disconnect = function(correlationId = null) {
  // Audit log the disconnection
  securityUtils.logSecurityEvent('USER_DISCONNECT', {
    severity: 'INFO',
    userId: this.userId,
    correlationId,
    details: 'User disconnected Google integration'
  });

  // Securely wipe tokens before clearing
  if (this.accessToken) {
    securityUtils.secureWipe(this.accessToken);
  }
  if (this.refreshToken) {
    securityUtils.secureWipe(this.refreshToken);
  }

  this.connected = false;
  this.calendarSyncEnabled = false;
  this.accessToken = null;
  this.refreshToken = null;
  this.tokenExpiresAt = null;
  this.calendarId = null;
};

export default mongoose.model("UserGoogleIntegration", userGoogleIntegrationSchema);