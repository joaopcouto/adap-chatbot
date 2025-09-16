import express from 'express';
import { google } from 'googleapis';
import UserGoogleIntegrationService from '../services/userGoogleIntegrationService.js';
import GoogleCalendarService from '../services/googleCalendarService.js';
import User from '../models/User.js';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';

const router = express.Router();

// OAuth configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Scopes required for Google Calendar integration
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

/**
 * Middleware to validate user authentication
 * For now, we'll use phone number as user identifier
 */
const authenticateUser = async (req, res, next) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required for authentication'
    });
  }

  try {
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * GET /google/auth-url
 * Generate Google OAuth authorization URL
 */
router.post('/auth-url', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Generating Google OAuth URL', {
      correlationId,
      userId: req.user._id
    });

    // Generate a state parameter to prevent CSRF attacks
    const state = Buffer.from(JSON.stringify({
      userId: req.user._id.toString(),
      timestamp: Date.now(),
      source: 'whatsapp'
    })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: state,
      prompt: 'consent' // Force consent screen to ensure refresh token
    });

    res.json({
      success: true,
      data: {
        authUrl,
        state
      }
    });

  } catch (error) {
    structuredLogger.error('Error generating OAuth URL', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL'
    });
  }
});

/**
 * GET /google/callback
 * Handle OAuth callback from Google (for WhatsApp users)
 */
router.get('/callback', async (req, res) => {
  const correlationId = generateCorrelationId();
  const { code, state, error } = req.query;

  // Handle OAuth errors
  if (error) {
    structuredLogger.error('Google OAuth error', {
      correlationId,
      error,
      errorDescription: req.query.error_description
    });

    // Provide specific error messages based on error type
    let errorMessage = 'Houve um problema ao conectar sua conta Google.';
    let solution = 'Volte ao WhatsApp e tente novamente digitando "conectar google calendar".';

    if (error === 'access_denied') {
      errorMessage = 'Acesso negado pelo Google.';
      solution = `
        <strong>Possíveis soluções:</strong><br>
        1. O app pode estar em modo de teste - contate o desenvolvedor<br>
        2. Você cancelou a autorização - tente novamente<br>
        3. Sua conta pode não ter permissão - use uma conta Google pessoal<br><br>
        <strong>Para tentar novamente:</strong><br>
        Volte ao WhatsApp e digite "conectar google calendar"
      `;
    } else if (error === 'invalid_request') {
      errorMessage = 'Solicitação inválida.';
      solution = 'O link pode ter expirado. Solicite um novo link no WhatsApp.';
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erro na Conexão - Google Calendar</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .error { color: #e74c3c; }
          .icon { font-size: 48px; margin-bottom: 20px; }
          .solution { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
          .code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">❌</div>
          <h2 class="error">Erro na Conexão</h2>
          <p>${errorMessage}</p>
          
          <div class="solution">
            <p>${solution}</p>
          </div>

          <p><strong>Código do erro:</strong> <span class="code">${error}</span></p>
          
          <hr style="margin: 30px 0;">
          
          <h3>🔧 Precisa de ajuda?</h3>
          <p>Se o problema persistir, entre em contato com o suporte técnico informando o código do erro acima.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!code || !state) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Parâmetros Inválidos</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .error { color: #e74c3c; }
          .icon { font-size: 48px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠️</div>
          <h2 class="error">Parâmetros Inválidos</h2>
          <p>Link de autorização inválido ou expirado.</p>
          <p>Volte ao WhatsApp e solicite um novo link digitando "conectar google calendar".</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    structuredLogger.info('Processing Google OAuth callback for WhatsApp user', {
      correlationId,
      hasCode: !!code,
      hasState: !!state
    });

    // Verify and decode state parameter
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (error) {
      throw new Error('Invalid state parameter format');
    }

    if (!stateData.userId || stateData.source !== 'whatsapp') {
      throw new Error('Invalid state parameter data');
    }

    // Check if state is not too old (10 minutes)
    const stateAge = Date.now() - stateData.timestamp;
    if (stateAge > 10 * 60 * 1000) {
      throw new Error('Authorization link expired');
    }

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    // Connect the user's Google account
    const integration = await UserGoogleIntegrationService.connectGoogle(stateData.userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: Math.floor((tokens.expiry_date - Date.now()) / 1000)
    }, correlationId);

    // Enable calendar sync by default
    await UserGoogleIntegrationService.setCalendarSyncEnabled(stateData.userId, true);

    structuredLogger.info('Google account connected successfully via WhatsApp callback', {
      correlationId,
      userId: stateData.userId,
      hasRefreshToken: !!tokens.refresh_token
    });

    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conexão Realizada com Sucesso</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .success { color: #27ae60; }
          .icon { font-size: 48px; margin-bottom: 20px; }
          .features { text-align: left; margin: 20px 0; }
          .features li { margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✅</div>
          <h2 class="success">Google Calendar Conectado!</h2>
          <p>Sua conta foi conectada com sucesso. Agora seus lembretes serão sincronizados automaticamente!</p>
          
          <div class="features">
            <h3>✨ O que acontece agora:</h3>
            <ul>
              <li>📅 Novos lembretes aparecerão no seu Google Calendar</li>
              <li>🔄 Sincronização automática ativada</li>
              <li>📱 Acesso em todos os seus dispositivos</li>
              <li>🔒 Seus dados ficam seguros e criptografados</li>
            </ul>
          </div>

          <p><strong>Você pode fechar esta página e voltar ao WhatsApp.</strong></p>
          
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Para gerenciar suas configurações, digite "status google calendar" no WhatsApp.
          </p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    structuredLogger.error('Error processing Google OAuth callback for WhatsApp user', {
      correlationId,
      error: error.message
    });

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erro no Processamento</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .error { color: #e74c3c; }
          .icon { font-size: 48px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">❌</div>
          <h2 class="error">Erro no Processamento</h2>
          <p>Houve um problema ao processar sua autorização.</p>
          <p><strong>Detalhes:</strong> ${error.message}</p>
          <p>Volte ao WhatsApp e tente novamente digitando "conectar google calendar".</p>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * POST /google/connect
 * Handle OAuth callback and connect Google account
 */
router.post('/connect', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();
  const { code, state } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Authorization code is required'
    });
  }

  try {
    structuredLogger.info('Processing Google OAuth callback', {
      correlationId,
      userId: req.user._id
    });

    // Verify state parameter
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        if (stateData.userId !== req.user._id.toString()) {
          return res.status(400).json({
            success: false,
            error: 'Invalid state parameter'
          });
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid state parameter format'
        });
      }
    }

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    // Connect the user's Google account
    const integration = await UserGoogleIntegrationService.connectGoogle(req.user._id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: Math.floor((tokens.expiry_date - Date.now()) / 1000)
    });

    structuredLogger.info('Google account connected successfully', {
      correlationId,
      userId: req.user._id,
      hasRefreshToken: !!tokens.refresh_token
    });

    res.json({
      success: true,
      data: {
        connected: integration.connected,
        calendarSyncEnabled: integration.calendarSyncEnabled,
        timezone: integration.timezone
      },
      message: 'Google account connected successfully'
    });

  } catch (error) {
    structuredLogger.error('Error connecting Google account', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to connect Google account'
    });
  }
});

/**
 * POST /google/disconnect
 * Disconnect Google account and revoke tokens
 */
router.post('/disconnect', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();

  try {
    structuredLogger.info('Disconnecting Google account', {
      correlationId,
      userId: req.user._id
    });

    // Get current integration to revoke tokens
    const integration = await UserGoogleIntegrationService.getUserIntegration(req.user._id);
    
    if (integration && integration.connected) {
      // Revoke tokens with Google
      try {
        await GoogleCalendarService.revokeTokens(
          integration.accessToken,
          integration.refreshToken
        );
        structuredLogger.info('Google tokens revoked successfully', {
          correlationId,
          userId: req.user._id
        });
      } catch (error) {
        // Log but don't fail the disconnect process
        structuredLogger.warn('Failed to revoke Google tokens', {
          correlationId,
          userId: req.user._id,
          error: error.message
        });
      }
    }

    // Disconnect in our database
    const updatedIntegration = await UserGoogleIntegrationService.disconnectGoogle(req.user._id);

    structuredLogger.info('Google account disconnected successfully', {
      correlationId,
      userId: req.user._id
    });

    res.json({
      success: true,
      data: {
        connected: false,
        calendarSyncEnabled: false
      },
      message: 'Google account disconnected successfully'
    });

  } catch (error) {
    structuredLogger.error('Error disconnecting Google account', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to disconnect Google account'
    });
  }
});

/**
 * GET /google/status
 * Get current Google integration status and preferences
 */
router.post('/status', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();

  try {
    const integration = await UserGoogleIntegrationService.getUserIntegration(req.user._id);

    if (!integration) {
      return res.json({
        success: true,
        data: {
          connected: false,
          calendarSyncEnabled: false,
          timezone: 'America/Sao_Paulo',
          calendarId: null,
          defaultReminders: []
        }
      });
    }

    res.json({
      success: true,
      data: {
        connected: integration.connected,
        calendarSyncEnabled: integration.calendarSyncEnabled,
        timezone: integration.timezone,
        calendarId: integration.calendarId,
        defaultReminders: integration.defaultReminders || [],
        tokenExpiresAt: integration.tokenExpiresAt,
        hasValidIntegration: integration.hasValidIntegration()
      }
    });

  } catch (error) {
    structuredLogger.error('Error getting Google integration status', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get integration status'
    });
  }
});

/**
 * POST /google/preferences
 * Update Google Calendar sync preferences
 */
router.post('/preferences', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();
  const { 
    calendarSyncEnabled, 
    calendarId, 
    timezone, 
    defaultReminders 
  } = req.body;

  try {
    structuredLogger.info('Updating Google integration preferences', {
      correlationId,
      userId: req.user._id,
      calendarSyncEnabled,
      timezone
    });

    // Validate inputs
    const updates = {};

    if (typeof calendarSyncEnabled === 'boolean') {
      updates.calendarSyncEnabled = calendarSyncEnabled;
    }

    if (calendarId !== undefined) {
      if (calendarId === null || typeof calendarId === 'string') {
        updates.calendarId = calendarId;
      } else {
        return res.status(400).json({
          success: false,
          error: 'calendarId must be a string or null'
        });
      }
    }

    if (timezone !== undefined) {
      if (typeof timezone === 'string' && timezone.length > 0) {
        updates.timezone = timezone;
      } else {
        return res.status(400).json({
          success: false,
          error: 'timezone must be a non-empty string'
        });
      }
    }

    if (defaultReminders !== undefined) {
      if (Array.isArray(defaultReminders)) {
        // Validate that all reminders are positive numbers
        const validReminders = defaultReminders.every(r => 
          typeof r === 'number' && r >= 0 && Number.isInteger(r)
        );
        
        if (!validReminders) {
          return res.status(400).json({
            success: false,
            error: 'defaultReminders must be an array of non-negative integers'
          });
        }
        
        updates.defaultReminders = defaultReminders;
      } else {
        return res.status(400).json({
          success: false,
          error: 'defaultReminders must be an array'
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid preferences provided to update'
      });
    }

    // Check if user has Google integration
    const integration = await UserGoogleIntegrationService.getUserIntegration(req.user._id);
    
    if (!integration || !integration.connected) {
      return res.status(400).json({
        success: false,
        error: 'Google account must be connected before setting preferences'
      });
    }

    // Update preferences
    const updatedIntegration = await UserGoogleIntegrationService.updateUserIntegration(
      req.user._id, 
      updates
    );

    structuredLogger.info('Google integration preferences updated successfully', {
      correlationId,
      userId: req.user._id,
      updatedFields: Object.keys(updates)
    });

    res.json({
      success: true,
      data: {
        connected: updatedIntegration.connected,
        calendarSyncEnabled: updatedIntegration.calendarSyncEnabled,
        timezone: updatedIntegration.timezone,
        calendarId: updatedIntegration.calendarId,
        defaultReminders: updatedIntegration.defaultReminders || []
      },
      message: 'Preferences updated successfully'
    });

  } catch (error) {
    structuredLogger.error('Error updating Google integration preferences', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update preferences'
    });
  }
});

/**
 * GET /google/calendars
 * Get list of user's Google Calendars
 */
router.post('/calendars', authenticateUser, async (req, res) => {
  const correlationId = generateCorrelationId();

  try {
    const integration = await UserGoogleIntegrationService.getUserIntegration(req.user._id);

    if (!integration || !integration.connected) {
      return res.status(400).json({
        success: false,
        error: 'Google account must be connected to list calendars'
      });
    }

    // Create OAuth client with user's tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.getDecryptedRefreshToken(),
      expiry_date: integration.tokenExpiresAt?.getTime()
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get calendar list
    const response = await calendar.calendarList.list({
      maxResults: 50,
      showHidden: false
    });

    const calendars = response.data.items?.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      primary: cal.primary || false,
      accessRole: cal.accessRole,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor
    })) || [];

    structuredLogger.info('Retrieved user calendars', {
      correlationId,
      userId: req.user._id,
      calendarCount: calendars.length
    });

    res.json({
      success: true,
      data: {
        calendars,
        currentCalendarId: integration.calendarId
      }
    });

  } catch (error) {
    structuredLogger.error('Error retrieving user calendars', {
      correlationId,
      userId: req.user._id,
      error: error.message
    });

    // Handle specific Google API errors
    if (error.response?.status === 401) {
      res.status(401).json({
        success: false,
        error: 'Google authentication expired. Please reconnect your account.',
        requiresReconnection: true
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve calendars'
      });
    }
  }
});

export default router;