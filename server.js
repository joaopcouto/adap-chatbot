import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import rateLimitMongo from "rate-limit-mongo";
import { connectToDatabase } from "./src/config/database.js";
import webhookRouter from "./src/routes/webhook.js";
import { startInstallmentJob } from './src/jobs/installmentProcessorJob.js';

const app = express();
app.use("/images", express.static("/tmp"));
app.use(express.urlencoded({ extended: true }));

const mongoStore = new rateLimitMongo({
  uri: process.env.MONGO_URI,
  collectionName: "rateLimits",
  expireTimeMs: 60 * 1000, 
});

const userLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 60, 
  message: {
    status: 429,
    body: "🚫 Você excedeu o limite de requisições. Tente novamente mais tarde."
  },
  standardHeaders: true, 
  legacyHeaders: false, 
  keyGenerator: (req) => {
    return req.body?.From || req.ip;
  },
  store: mongoStore
})

app.use("/webhook", userLimiter, webhookRouter);

connectToDatabase()
  .then(() => {
    console.log("✅ MongoDB conectado");
    startInstallmentJob();
  })
  .catch((err) => console.error("❌ Erro na conexão:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});