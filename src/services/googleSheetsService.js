import { google } from 'googleapis';
import path from 'path';
import UserActivity from '../models/UserActivity.js';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
let auth;

if (process.env.NODE_ENV === 'prod' && process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = google.auth.fromJSON(credentials);
    auth.scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  } catch (error) {
    console.error('❌ Falha ao parsear GOOGLE_CREDENTIALS_JSON:', error);
  }
} else {
  const KEYFILEPATH = path.join(process.cwd(), 'credentials.json');
  auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

const sheets = google.sheets({ version: 'v4', auth });

export async function syncUserActivityToSheet() {
  if (!auth) {
    console.error('❌ Autenticação com o Google falhou. Verifique as credenciais.');
    return;
  }
  if (!SPREADSHEET_ID) {
    console.error('❌ GOOGLE_SHEET_ID não está definido no arquivo .env. Sincronização abortada.');
    return;
  }
  
  try {
    console.log('🔄 Iniciando sincronização com o Google Sheets...');
    const activities = await UserActivity.find({}).sort({ lastInteractionAt: -1 }).lean();

    if (activities.length === 0) {
        console.log('✅ Nenhum dado de atividade para sincronizar.');
        return;
    }

    const rows = activities.map(act => [
      act.userId.toString(),
      act.name,
      act.email,
      act.phoneNumber,
      act.messageCount,
      act.lastInteractionAt ? act.lastInteractionAt.toISOString() : '',
      act.createdAt ? act.createdAt.toISOString() : '',
    ]);

    const resource = {
      values: [
        ['UserID', 'Nome', 'Email', 'Telefone', 'Contagem de Mensagens', 'Última Interação', 'Data de Criação'],
        ...rows,
      ],
    };

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Página1!A:G', 
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Página1!A1',
      valueInputOption: 'USER_ENTERED',
      resource,
    });
    
    console.log(`✅ Planilha sincronizada com sucesso. ${rows.length} registros atualizados.`);

  } catch (error) {
    console.error('❌ Erro durante a sincronização com o Google Sheets:', error.message);
  }
}