import mongoose from 'mongoose';
import 'dotenv/config'; 
import Permissions from './src/models/Permissions.js'; 
import { connectToDatabase } from './src/config/database.js';

const userId = process.argv[2];
const productId = process.argv[3];
const monthsValid = parseFloat(process.argv[4]) || 12;

if (!userId || !productId) {
  console.error('ERRO: Por favor, forneça o userId e o productId.');
  console.log('Uso: node addPermission.js <userId> <productId> [mesesDeValidade]');
  process.exit(1);
}

const expiresAt = new Date();
expiresAt.setMonth(expiresAt.getMonth() + monthsValid);

async function run() {
  try {
    await connectToDatabase();
    console.log('✅ Conectado ao MongoDB');

    const newPermission = new Permissions({
      userId,
      productId,
      access: true,
      expiresAt,
    });

    await newPermission.save();

    console.log('🚀 Permissão adicionada com sucesso!');
    console.log(newPermission); 

  } catch (error) {
    console.error('❌ Erro ao adicionar permissão:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB');
  }
}

run();