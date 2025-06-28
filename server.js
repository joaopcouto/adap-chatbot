import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import rateLimitMongo from "rate-limit-mongo";
import { connectToDatabase } from "./src/config/database.js";
import webhookRouter from "./src/routes/webhook.js";
import { startInstallmentReminderJob } from "./src/jobs/installmentReminderJob.js";

const app = express();
app.use("/images", express.static("/tmp"));
app.use(express.urlencoded({ extended: true }));

// Store baseado em Mongo (evita reiniciar contadores ao subir nova instância)
const mongoStore = new rateLimitMongo({
  uri: process.env.MONGO_URI,
  collectionName: "rateLimits",
  expireTimeMs: 60 * 1000, // Limpa chaves pós 60s
});

// Limiter por usuário (phone number)
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // até 60reqs/min por usuário
  message: {
    status: 429,
    body: "🚫 Você excedeu o limite de requisições. Tente novamente mais tarde.",
  },
  standardHeaders: true, // retorna headers padrão
  legacyHeaders: false, // não retorna headers antigos
  keyGenerator: (req) => {
    // Usa o número do telefone como chave
    // Se não houver número do telefone, usa o IP
    return req.body?.From || req.ip;
  },
  store: mongoStore,
});

app.use("/webhook", userLimiter, webhookRouter);

connectToDatabase()
  .then(() => {
    console.log("✅ MongoDB conectado");
    startInstallmentReminderJob(); // INICIA O NOVO JOB
  })
  .catch((err) => console.error("❌ Erro na conexão:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
