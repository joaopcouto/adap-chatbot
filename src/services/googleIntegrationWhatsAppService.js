import { google } from 'googleapis';
import UserGoogleIntegrationService from './userGoogleIntegrationService.js';
import GoogleCalendarService from './googleCalendarService.js';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import configManager from '../config/config.js';
import securityUtils from '../utils/securityUtils.js';

/**
 * Service to handle Google Calendar integration via WhatsApp
 */
class GoogleIntegrationWhatsAppService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      configManager.get('google.clientId'),
      configManager.get('google.clientSecret'),
      configManager.get('google.redirectUri')
    );
    
    this.scopes = ['https://www.googleapis.com/auth/calendar.events'];
  }

  /**
   * Generate Google OAuth authorization URL for WhatsApp user
   * @param {string} userId - User ID (ObjectId)
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Authorization URL and state
   */
  async generateAuthUrl(userId, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      structuredLogger.info('Generating Google OAuth URL for WhatsApp user', {
        correlationId: cId,
        userId
      });

      // Validate user ID
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      // Generate a secure state parameter to prevent CSRF attacks
      const stateData = {
        userId: userId.toString(),
        timestamp: Date.now(),
        source: 'whatsapp'
      };
      
      const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: this.scopes,
        state: state,
        prompt: 'consent', // Force consent screen to ensure refresh token
        include_granted_scopes: true
      });

      // Log security event
      securityUtils.logSecurityEvent('OAUTH_URL_GENERATED', {
        severity: 'INFO',
        userId,
        correlationId: cId,
        details: 'Google OAuth URL generated for WhatsApp user'
      });

      return {
        success: true,
        authUrl,
        state,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      };

    } catch (error) {
      structuredLogger.error('Error generating OAuth URL for WhatsApp user', {
        correlationId: cId,
        userId,
        error: error.message
      });

      securityUtils.logSecurityEvent('OAUTH_URL_GENERATION_FAILED', {
        severity: 'ERROR',
        userId,
        correlationId: cId,
        details: `Failed to generate OAuth URL: ${error.message}`
      });

      throw new Error('Failed to generate authorization URL');
    }
  }

  /**
   * Get current Google integration status for user
   * @param {string} userId - User ID (ObjectId)
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Integration status
   */
  async getIntegrationStatus(userId, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      // Validate user ID
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      const integration = await UserGoogleIntegrationService.getUserIntegration(userId);

      if (!integration) {
        return {
          connected: false,
          calendarSyncEnabled: false,
          timezone: 'America/Sao_Paulo',
          calendarId: null,
          defaultReminders: [],
          hasValidIntegration: false
        };
      }

      const status = {
        connected: integration.connected,
        calendarSyncEnabled: integration.calendarSyncEnabled,
        timezone: integration.timezone || 'America/Sao_Paulo',
        calendarId: integration.calendarId,
        defaultReminders: integration.defaultReminders || [],
        hasValidIntegration: integration.hasValidIntegration(),
        tokenExpiresAt: integration.tokenExpiresAt
      };

      structuredLogger.info('Retrieved Google integration status', {
        correlationId: cId,
        userId,
        connected: status.connected,
        syncEnabled: status.calendarSyncEnabled
      });

      return status;

    } catch (error) {
      structuredLogger.error('Error getting Google integration status', {
        correlationId: cId,
        userId,
        error: error.message
      });

      throw new Error('Failed to get integration status');
    }
  }

  /**
   * Disconnect Google account for user
   * @param {string} userId - User ID (ObjectId)
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Disconnection result
   */
  async disconnectGoogle(userId, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      structuredLogger.info('Disconnecting Google account via WhatsApp', {
        correlationId: cId,
        userId
      });

      // Validate user ID
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      // Get current integration to revoke tokens
      const integration = await UserGoogleIntegrationService.getUserIntegration(userId);
      
      if (integration && integration.connected) {
        // Revoke tokens with Google
        try {
          const googleCalendarService = new GoogleCalendarService();
          await googleCalendarService.revokeTokens(
            integration.accessToken,
            integration.refreshToken
          );
          
          structuredLogger.info('Google tokens revoked successfully', {
            correlationId: cId,
            userId
          });
        } catch (error) {
          // Log but don't fail the disconnect process
          structuredLogger.warn('Failed to revoke Google tokens', {
            correlationId: cId,
            userId,
            error: error.message
          });
        }
      }

      // Disconnect in our database
      const updatedIntegration = await UserGoogleIntegrationService.disconnectGoogle(userId, cId);

      structuredLogger.info('Google account disconnected successfully via WhatsApp', {
        correlationId: cId,
        userId
      });

      return {
        success: true,
        connected: false,
        calendarSyncEnabled: false,
        message: 'Google Calendar desconectado com sucesso!'
      };

    } catch (error) {
      structuredLogger.error('Error disconnecting Google account via WhatsApp', {
        correlationId: cId,
        userId,
        error: error.message
      });

      throw new Error('Failed to disconnect Google account');
    }
  }

  /**
   * Enable or disable calendar sync for user
   * @param {string} userId - User ID (ObjectId)
   * @param {boolean} enabled - Whether to enable sync
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Update result
   */
  async setCalendarSyncEnabled(userId, enabled, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      structuredLogger.info('Updating calendar sync setting via WhatsApp', {
        correlationId: cId,
        userId,
        enabled
      });

      // Validate inputs
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      if (typeof enabled !== 'boolean') {
        throw new Error('Enabled parameter must be boolean');
      }

      // Check if user has Google integration
      const integration = await UserGoogleIntegrationService.getUserIntegration(userId);
      
      if (!integration || !integration.connected) {
        throw new Error('Google account must be connected before enabling sync');
      }

      // Update sync setting
      const updatedIntegration = await UserGoogleIntegrationService.setCalendarSyncEnabled(userId, enabled);

      const message = enabled 
        ? '✅ Sincronização com Google Calendar ativada! Seus lembretes agora aparecerão no seu calendário.'
        : '⏸️ Sincronização com Google Calendar desativada. Seus lembretes continuarão sendo salvos localmente.';

      structuredLogger.info('Calendar sync setting updated successfully', {
        correlationId: cId,
        userId,
        enabled
      });

      return {
        success: true,
        calendarSyncEnabled: enabled,
        connected: updatedIntegration.connected,
        message
      };

    } catch (error) {
      structuredLogger.error('Error updating calendar sync setting', {
        correlationId: cId,
        userId,
        enabled,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Format integration status for WhatsApp message
   * @param {Object} status - Integration status object
   * @returns {string} Formatted status message
   */
  formatStatusMessage(status) {
    if (!status.connected) {
      return `📅 *Status do Google Calendar*

❌ *Não conectado*

Para conectar sua conta Google e sincronizar seus lembretes com o Google Calendar, digite:
"conectar google calendar"

✨ *Benefícios da integração:*
• Seus lembretes aparecem no Google Calendar
• Sincronização automática
• Acesso em todos os dispositivos
• Lembretes nunca são perdidos`;
    }

    const syncStatus = status.calendarSyncEnabled ? '✅ Ativada' : '⏸️ Desativada';
    const validIntegration = status.hasValidIntegration ? '✅ Válida' : '⚠️ Requer reconexão';
    
    let message = `📅 *Status do Google Calendar*

✅ *Conectado*
🔄 *Sincronização:* ${syncStatus}
🔐 *Autenticação:* ${validIntegration}
🌍 *Timezone:* ${status.timezone}`;

    if (status.calendarId && status.calendarId !== 'primary') {
      message += `\n📋 *Calendário:* ${status.calendarId}`;
    }

    if (status.defaultReminders && status.defaultReminders.length > 0) {
      const reminders = status.defaultReminders.map(r => `${r}min`).join(', ');
      message += `\n⏰ *Lembretes padrão:* ${reminders}`;
    }

    message += `\n\n*Comandos disponíveis:*`;
    
    if (status.calendarSyncEnabled) {
      message += `\n• "desativar google calendar" - Desativar sincronização`;
    } else {
      message += `\n• "ativar google calendar" - Ativar sincronização`;
    }
    
    message += `\n• "desconectar google calendar" - Desconectar conta`;

    return message;
  }

  /**
   * Get diagnostic information about Google integration configuration
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Diagnostic information
   */
  async getDiagnosticInfo(correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        correlationId: cId,
        configuration: {
          clientId: configManager.get('google.clientId') ? '✅ Configurado' : '❌ Faltando',
          clientSecret: configManager.get('google.clientSecret') ? '✅ Configurado' : '❌ Faltando',
          redirectUri: configManager.get('google.redirectUri') || '❌ Faltando',
          encryptionKey: configManager.get('encryption.key') !== 'default-key-for-development-only' ? '✅ Configurado' : '⚠️ Usando chave padrão'
        },
        featureFlags: {
          googleCalendarIntegrationEnabled: configManager.isFeatureEnabled('googleCalendarIntegrationEnabled') ? '✅ Ativado' : '❌ Desativado',
          syncRetryEnabled: configManager.isFeatureEnabled('syncRetryEnabled') ? '✅ Ativado' : '❌ Desativado'
        },
        environment: configManager.get('nodeEnv') || 'unknown'
      };

      structuredLogger.info('Generated diagnostic information', {
        correlationId: cId,
        hasClientId: !!configManager.get('google.clientId'),
        hasClientSecret: !!configManager.get('google.clientSecret'),
        hasRedirectUri: !!configManager.get('google.redirectUri')
      });

      return diagnostics;

    } catch (error) {
      structuredLogger.error('Error generating diagnostic information', {
        correlationId: cId,
        error: error.message
      });

      throw new Error('Failed to generate diagnostic information');
    }
  }

  /**
   * Format diagnostic information for WhatsApp message
   * @param {Object} diagnostics - Diagnostic information object
   * @returns {string} Formatted diagnostic message
   */
  formatDiagnosticMessage(diagnostics) {
    const { configuration, featureFlags, environment } = diagnostics;
    
    let message = `🔧 *Diagnóstico Google Calendar*

📋 *Configuração OAuth:*
• Client ID: ${configuration.clientId}
• Client Secret: ${configuration.clientSecret}
• Redirect URI: ${configuration.redirectUri}
• Chave Criptografia: ${configuration.encryptionKey}

🚩 *Feature Flags:*
• Integração Google: ${featureFlags.googleCalendarIntegrationEnabled}
• Retry Automático: ${featureFlags.syncRetryEnabled}

🌍 *Ambiente:* ${environment}`;

    // Check for common issues
    const issues = [];
    if (configuration.clientId.includes('❌')) {
      issues.push('• Configure GOOGLE_CLIENT_ID no .env');
    }
    if (configuration.clientSecret.includes('❌')) {
      issues.push('• Configure GOOGLE_CLIENT_SECRET no .env');
    }
    if (configuration.redirectUri.includes('❌')) {
      issues.push('• Configure GOOGLE_REDIRECT_URI no .env');
    }
    if (configuration.encryptionKey.includes('⚠️')) {
      issues.push('• Configure TOKEN_ENCRYPTION_KEY segura');
    }
    if (featureFlags.googleCalendarIntegrationEnabled.includes('❌')) {
      issues.push('• Ative GOOGLE_CALENDAR_INTEGRATION_ENABLED=true');
    }

    if (issues.length > 0) {
      message += `\n\n⚠️ *Problemas Encontrados:*\n${issues.join('\n')}`;
      message += `\n\n📖 *Solução:*\nConsulte a documentação em docs/google-oauth-setup.md ou configure as variáveis de ambiente necessárias.`;
    } else {
      message += `\n\n✅ *Status:* Configuração parece estar correta!`;
    }

    message += `\n\n🕐 *Gerado em:* ${new Date(diagnostics.timestamp).toLocaleString('pt-BR')}`;
    message += `\n📋 *ID:* ${diagnostics.correlationId}`;

    return message;
  }

  /**
   * Generate connection instructions message
   * @param {string} authUrl - Google OAuth authorization URL
   * @returns {string} Formatted instructions message
   */
  formatConnectionMessage(authUrl) {
    return `🔗 *Conectar Google Calendar*

Para sincronizar seus lembretes com o Google Calendar, siga estes passos:

*1.* Clique no link abaixo para autorizar o acesso:
${authUrl}

*2.* Faça login na sua conta Google

*3.* Autorize o acesso ao Google Calendar

*4.* Após autorizar, a sincronização será ativada automaticamente

⚠️ *Importante:*
• O link expira em 10 minutos
• Use apenas sua conta Google pessoal
• Seus dados ficam seguros e criptografados

✨ *Após conectar:*
• Todos os novos lembretes aparecerão no seu Google Calendar
• Você pode ativar/desativar a sincronização a qualquer momento
• Seus lembretes continuam salvos localmente mesmo se desconectar`;
  }
}

export default new GoogleIntegrationWhatsAppService();