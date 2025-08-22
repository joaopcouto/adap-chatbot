import { OpenAI } from "openai";
import axios from "axios";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import stream from "stream";
import { devLog } from "../helpers/logger.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pipeline = promisify(stream.pipeline);

export async function transcribeAudioWithWhisper(audioUrl) {
  try {
    const response = await axios({
      method: "get",
      url: audioUrl,
      responseType: "stream",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    const tempFilePath = path.join("/tmp", `user_audio_${Date.now()}.ogg`);

    await pipeline(response.data, fs.createWriteStream(tempFilePath));

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
      language: "pt",
    });

    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return transcription.text;
  } catch (error) {
    console.error("Erro no processo de transcrição com Whisper:", error);
    throw new Error("Falha ao transcrever o áudio.");
  }
}

export async function interpretMessageWithAI(message, currentDate) {
  const now = new Date(currentDate);
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const currentDay = String(now.getDate()).padStart(2, "0");
  const monthName = now.toLocaleString("pt-BR", { month: "long" });
  const dayOfWeekName = now.toLocaleString("pt-BR", { weekday: "long" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split("T")[0] + "T00:00:00.000Z";

  const prompt = `Você é um assistente financeiro altamente inteligente especializado em interpretar mensagens de usuários relacionadas a finanças pessoais, orçamento e investimentos. Sua tarefa é determinar com precisão a intenção do usuário e extrair dados financeiros estruturados de sua mensagem. Garanta precisão e compreensão contextual ao categorizar despesas.

  Instruções:

  **CONTEXTO DO ANO ATUAL (Use para resolver datas relativas. NÃO inclua na resposta JSON):**
  - Ano atual: ${currentYear}
  - Mês atual: ${currentMonth} (${monthName})
  - Dia atual: ${currentDay} (${dayOfWeekName})

  1. Identificar a Intenção:
     Determine a intenção do usuário com base em sua mensagem. As possíveis intenções incluem:
      "add_income" → O usuário quer registrar uma receita. Extraia o valor, descrição e categoria. 
      "add_expense" → O usuário quer registrar uma despesa. Extraia o valor, descrição e categoria.
      "add_transaction_new_category" → O usuário quer registrar uma transação (receita ou despesa) com uma nova categoria. Extraia o valor, descrição, categoria e tipo.
      "add_installment_expense" → O usuário quer registrar uma despesa parcelada. O usuário fornecerá descrição, o valor TOTAL e o número de parcelas.
      "delete_installment_group" → O usuário quer excluir um plano de parcelamento inteiro. Extraia o installmentsGroupId.
      "delete_transaction" → O usuário quer excluir uma despesa. Extraia o messageId.
      "delete_list_item" → O usuário quer apagar um item de uma lista numerada recém-exibida. Extraia o número do item.
      "generate_daily_chart" → O usuário quer gerar um gráfico de despesas diárias. Extraia a quantidade de dias.  
      "generate_category_chart" → O usuário quer gerar um gráfico de despesas por categoria. Extraia os dias.
      "get_total_income" → O usuário quer recuperar o valor total de receitas.
      "get_total" → O usuário quer recuperar o valor total gasto ou recebido para um mês específico, ou o mês atual, opcionalmente filtrado por uma categoria específica.
      "get_active_installments" → O usuário quer uma lista de todos os seus planos de parcelamento ativos.
      "detalhes" → O usuário quer mostrar uma lista de todos os itens em uma determinada data"
      "greeting" → O usuário envia uma saudação (ex: "Oi", "Olá").
      "instructions" → O usuário pergunta como usar o assistente ou o que ele pode fazer.
      "reminder" → O usuário pede um lembrete ou notificação sobre um compromisso, evento ou tarefa.
      "delete_reminder" → O usuário pede para excluir um lembrete. Extraia o messageId.
      "get_total_reminders" → O usuário pede todos os lembretes futuros.
      "financial_help" → O usuário faz uma pergunta geral relacionada a finanças (ex: investimentos, poupança, estratégias).
      "unknown" → A mensagem não corresponde a nenhuma das intenções acima.
  
  2. Regras de Extração de Dados:
    - Para "add_expense" e "add_income": Extraia 'amount', 'description', 'category'. A estrutura é tipicamente "(valor) (descrição) em (categoria)".
    - Para "add_installment_expense": Extraia 'totalAmount', 'description' e 'installments'. A estrutura é tipicamente "(valor total) (descrição) em (parcelas)x" ou "parcelar (descrição) de (valor total) em (parcelas) vezes".
    - Para "delete_transaction": Extraia 'messageId'.
    - Para "reminder": Extraia 'description' e 'date' no formato ISO 8601.
    - Para "get_total" ou "get_total_income", se o usuário mencionar um mês (ex: "em Janeiro"), use o **Ano Atual** do contexto para formar o campo "month" (ex: "${currentYear}-01").
    - Para "reminder", resolva datas relativas como "amanhã", "dia 15", "próxima segunda" usando o **Contexto de Data Atual**. O formato da data deve ser ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ).
    - Regra de Categoria: Se a categoria fornecida NÃO estiver na lista de categorias válidas, a intenção DEVE ser "add_transaction_new_category".
      - Categorias válidas (despesa): "gastos fixos", "lazer", "investimento", "conhecimento", "doação"
      - Categorias válidas (receita): "Salário", "Renda Extra"


  3. Regras de Validação e Categorização:
    - Se a categoria não for especificada, determine-a com base na descrição usando as categorias válidas.
    - Se a categorização não estiver clara ou o usuário tiver acesso a "add_transaction_new_category" (categorias definidas pelo usuário), e houver uma despesa/receita passada com a mesma descrição, reutilize a última categoria conhecida usada para essa descrição.
    - Para a intenção "get_total", a categoria deve ser especificada, e pode ser qualquer categoria, incluindo as definidas pelo usuário.
    - Certifique-se de que o valor seja um número positivo válido; caso contrário, descarte ou solicite esclarecimento.
    - O assistente deve ler solicitações em português brasileiro e responder em português brasileiro.

    . Distinções Importantes:
     - Se o usuário perguntar **"onde"** (onde ocorreram as despesas) → use "generate_category_chart" (categorizado por categoria).
     - Se o usuário perguntar **"quais"** (quais despesas foram feitas) → use "generate_daily_chart" (categorizado por dia).
     Seja preciso: "onde" é sobre localização/tipo, "quais" é sobre listar as despesas dia a dia.
  
  4. Formato de Resposta:
       Responda apenas com um objeto JSON válido sem qualquer formatação ou explicação adicional
     - Retorne um objeto JSON com a intenção e dados extraídos. Use este formato:
       {
         "intent": "add_income" | "add_expense" | "add_transaction_new_category" | "add_installment_expense" | "delete_transaction" | "delete_list_item" | "generate_daily_chart" | "generate_category_chart" | "get_total_income" |"get_total" | "get_active_installments" | "greeting" | "instructions" | "reminder" | "delete_reminder" | "get_total_reminders" | "financial_help",
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "installmentsGroupId": string,
           "itemNumber": number,
           "messageId": string,
           "days": number,
           "month": string,
           "monthName": string,
           "date": string,
         }
       }
  
  5. Exemplos de Entradas do Usuário e Saídas Corretas: 
    - Usuário: "Recebi 1000 reais de salário"
      Resposta: { "intent": "add_income", "data": { "amount": 1000, "description": "salário", "category": null } }

    - Usuário: "12 lanche" 
      Resposta: { "intent": "add_expense", "data": { "amount": 12, "description": "lanche", "category": null } }
    - Usuário: "15 uber"
      Resposta: { "intent": "add_expense", "data": { "amount": 15, "description": "uber", "category": null } }
    - Usuário: "100 cofrinho inter em investimento"
      Resposta: { "intent": "add_expense", "data": { "amount": 100, "description": "cofrinho inter", "category": "investimento" } }

    - Usuário: "Recebi 20 com freelance na categoria extras"
      Resposta: { "intent": "add_transaction_new_category", "data": { "amount": 20, "description": "freelance", "category": "extras", "type": "income" } }
    - Usuário: "Gastei 20 com uber em transporte"
      Resposta: { "intent": "add_transaction_new_category", "data": { "amount": 20, "description": "uber", "category": "transporte", "type": "expense" } }
    - Usuário: "25 comida em alimentação"
      Resposta: { "intent": "add_transaction_new_category", "data": { "amount": 25, "description": "comida", "category": "alimentação", "type": "expense" } }
    - Usuário: "Recebi 930 com pix na categoria dívidas"
      Resposta: { "intent": "add_transaction_new_category", "data": { "amount": 930, "description": "pix", "category": "dívidas", "type": "income" } }
     
    - Usuário: "3500 PS5 em 10x"
      Resposta: { "intent": "add_installment_expense", "data": { "totalAmount": 3500, "description": "PS5", "installments": 10, "category": null } }
    - Usuário: "parcelei um celular de 2000 em 12 vezes na categoria gastos fixos"
      Resposta: { "intent": "add_installment_expense", "data": { "totalAmount": 2000, "description": "celular", "installments": 12, "category": "gastos fixos" } }
    - Usuário: "600 de passagem aérea em 3x"
      Resposta: { "intent": "add_installment_expense", "data": { "totalAmount": 600, "description": "passagem aérea", "installments": 3, "category": null } }
    - Usuário: "comprei uma televisão de 2400 em 4 vezes na categoria eletrônicos"
      Resposta: { "intent": "add_installment_expense", "data": { "totalAmount": 2400, "description": "televisão", "installments": 4, "category": eletrônicos } }
     
    - Usuário: "Remover gasto #4cdc9"
      Resposta: { "intent": "delete_transaction", "data": { "messageId": "4cdc9" } }

    - Usuário: "excluir o parcelamento #J-9tpH"
      Resposta: { "intent": "delete_installment_group", "data": { "installmentsGroupId": "J-9tpH" } }
    - Usuário: "cancelar compra parcelada #PXewd"
      Resposta: { "intent": "delete_installment_group", "data": { "installmentsGroupId": "PXewd" } }
    
    - User: "apagar item 3"
      Response: { "intent": "delete_list_item", "data": { "itemNumber": 3 } }

    - Usuário: "QUAIS foram meus gastos nos últimos 10 dias?"
      Resposta: { "intent": "generate_daily_chart", "data": { "days": 10}}

    - Usuário: "ONDE foram meus gastos nos últimos 7 dias?"
      Resposta: { "intent": "generate_category_chart", "data": { "days": 7}}

    - Usuário: "Qual é o meu gasto total?"
      Resposta: { "intent": "get_total", "data": {} }
    - Usuário: "Gasto total"
      Resposta: { "intent": "get_total", "data": {} }
    - Usuário: "Qual meu gasto total com lazer?"
      Resposta: { "intent": "get_total", "data": { "category": "lazer" } }
    - Usuário: "Qual meu gasto total com transporte em Janeiro?"
      Resposta: { "intent": "get_total", "data": { "category": "transporte", "month": "${currentYear}-01", "monthName": "Janeiro" } }
    - Usuário: "Quanto gastei em fevereiro?"
      Resposta: { "intent": "get_total", "data": { "month": "${currentYear}-02", "monthName": "Fevereiro" } }

    - Usuário: "Me mostre a receita de Renda Extra do mês de maio"  
      Resposta: { "intent": "get_total_income", "data": { "category": "Renda Extra", "month": "${currentYear}-05", "monthName": "Maio" } }
    - Usuário: "Qual é a minha receita total?"
      Resposta: { "intent": "get_total_income", "data": { } }
     
    - Usuário: "detalhes"
      Resposta: { "intent": "detalhes", "data": {} }

    - Usuário: "quais sao minhas compras parceladas"
      Resposta: { "intent": "get_active_installments", "data": {} }
    - Usuário: "parcelamentos ativos"
      Resposta: { "intent": "get_active_installments", "data": {} }

    - Usuário: "Olá!"
      Resposta: { "intent": "greeting", "data": {} }

    - Usuário: "Como usar?"
      Resposta: { "intent": "instructions", "data": {} }

    - Usuário: "Dia 15 preciso pagar o meu cartão de crédito"
      Resposta: { "intent": "reminder", "data": { "description": "pagar o meu cartão de crédito", "date": "2025-05-15T00:00:00.000Z" } }
    - Usuário: "Tenho consulta no dentista amanhã às 15h"
      Resposta: { "intent": "reminder", "data": { "description": "consulta no dentista", "date": "${tomorrowISO.replace(
        "T00:00:00.000Z",
        "T15:00:00.000Z"
      )}" } }

    - Usuário: "Quais são meus lembretes?"
      Resposta: { "intent": "get_total_reminders", "data":{} }

    - Usuário: "Devo investir mais em ações ou renda fixa?"
      Resposta: { "intent": "financial_help", "data": {} }
     
  
  Agora, interprete esta mensagem: "${message}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  });

  try {
    const cleanResponse = response.choices[0].message.content
      .replace(/```json\n|```/g, "")
      .trim();
    return JSON.parse(cleanResponse);
  } catch (err) {
    console.error(
      "Erro ao interpretar IA:",
      err,
      "Raw response:",
      response.choices[0].message.content
    );
    return { intent: "financial_help", data: {} };
  }
}

async function transcribeReceiptImage(base64Image, mimeType) {
  const prompt = `Você é um serviço de Reconhecimento Óptico de Caracteres (OCR) altamente preciso. Sua única função é extrair e transcrever o texto da imagem fornecida, de forma literal e bruta.

  REGRAS ESTRITAS:
  1.  **TRANSCREVA APENAS:** Retorne única e exclusivamente o texto que você vê na imagem.
  2.  **SEM INTERPRETAÇÃO:** Não analise, resuma, entenda ou comente sobre o conteúdo.
  3.  **SEM RECUSAS:** Não se desculpe, não se recuse a fazer a tarefa, não forneça explicações.
  4.  **MANTENHA A FORMATAÇÃO:** Preserve as quebras de linha e o espaçamento o máximo possível para manter a estrutura original do recibo.

  Sua saída deve ser apenas o texto bruto extraído.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Erro na Etapa 1 (Transcrição de Imagem):", error);
    return null;
  }
}

export async function extractItemsFromText(rawText) {
  const prompt = `Você é um especialista em analisar texto de notas fiscais brasileiras. Analise o texto abaixo e extraia uma lista de itens com descrição e preço.

  Texto da Nota Fiscal:
  """
  ${rawText}
  """

  Instruções:
  1.  Foque em extrair a lista de produtos/serviços com a maior precisão possível.
  2.  **REGRA CRÍTICA DE MOEDA:** Valores monetários em notas fiscais brasileiras usam VÍRGULA como separador decimal (ex: "R$ 10,99"). Ao extrair o valor numérico para o JSON, você OBRIGATORIAMENTE deve converter a vírgula para um PONTO (ex: 10.99). Nunca arredonde os valores.
  3.  Ignore informações como códigos de produto, peso, impostos, subtotais e totais.
  4.  Retorne a resposta APENAS em formato JSON, seguindo a estrutura:
      {
        "isReceipt": true,
        "items": [
          { "description": "nome do item 1", "amount": 15.99 },
          { "description": "nome do item 2", "amount": 8.50 }
        ]
      }
  5. Se o texto não parece ser de uma nota fiscal, retorne {"isReceipt": false, "items": []}.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });
    
    const cleanResponse = response.choices[0].message.content
      .replace(/```json\n|```/g, "")
      .trim();
    return JSON.parse(cleanResponse);

  } catch (error) {
    console.error("Erro na Etapa 2 (Extração de Texto):", error);
    return { isReceipt: false, items: [] };
  }
}

export async function interpretReceiptWithAI(imageUrl) {
  try {
    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'];
    
    const rawText = await transcribeReceiptImage(base64Image, mimeType);
    if (!rawText) {
      return { isReceipt: false, items: [] };
    }

    devLog("--- Texto Transcrito da Nota Fiscal ---\n", rawText, "\n-------------------------------------");
    const structuredData = await extractItemsFromText(rawText);

    return structuredData;

  } catch (error) {
    console.error("Erro no processo de interpretação de nota fiscal:", error);
    return { isReceipt: false, items: [] };
  }
}