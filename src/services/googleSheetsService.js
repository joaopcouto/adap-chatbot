import { google } from 'googleapis';
import path from 'path';
import UserActivity from '../models/UserActivity.js';

const KEYFILEPATH = path.join(process.cwd(), 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

export async function syncUserActivityToSheet() {
  try {
    const activities = await UserActivity.find({}).sort({ lastInteractionAt: -1 }).lean();

    const rows = activities.map(act => [
      act.userId.toString(),
      act.name,
      act.email,
      act.phoneNumber,
      act.messageCount,
      act.lastInteractionAt.toISOString(),
      act.createdAt.toISOString(),
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
    
    console.log('✅ Planilha do Google Sheets sincronizada com sucesso.');

  } catch (error) {
    console.error('❌ Erro ao sincronizar com o Google Sheets:', error);
  }
}