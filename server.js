import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import { connectToDatabase } from "./src/config/database.js";
import webhookRouter from "./src/routes/webhook.js";

const app = express();
app.use("/images", express.static("/tmp"));
app.use(bodyParser.urlencoded({ extended: false }));

app.use("/webhook", webhookRouter);

connectToDatabase()
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro na conexão:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});