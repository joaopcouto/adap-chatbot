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
      "generate_income_category_chart" → O usuário quer gerar um gráfico de receitas por categoria. Extraia os dias.
      "get_total_income" → O usuário quer recuperar o valor total de receitas.
      "get_total" → O usuário quer recuperar o valor total gasto ou recebido para um mês específico, ou o mês atual, opcionalmente filtrado por uma categoria específica.
      "get_active_installments" → O usuário quer uma lista de todos os seus planos de parcelamento ativos.
      "detalhes" → O usuário quer mostrar uma lista de todos os itens em uma determinada data"
      "greeting" → O usuário envia uma saudação (ex: "Oi", "Olá").
      "instructions" → O usuário pergunta como usar o assistente ou o que ele pode fazer.
      "reminder" → O usuário pede um lembrete ou notificação sobre um compromisso, evento ou tarefa.
      "delete_reminder" → O usuário pede para excluir um lembrete. Extraia o messageId.
      "get_total_reminders" → O usuário pede todos os lembretes futuros.
      "google_connect" → O usuário quer conectar sua conta Google para sincronizar lembretes com Google Calendar.
      "google_disconnect" → O usuário quer desconectar sua conta Google e parar a sincronização.
      "google_status" → O usuário quer verificar o status da integração com Google Calendar.
      "google_enable_sync" → O usuário quer habilitar a sincronização de lembretes com Google Calendar.
      "google_disable_sync" → O usuário quer desabilitar a sincronização de lembretes com Google Calendar.
      "google_debug" → O usuário quer informações de diagnóstico sobre a configuração Google.
      "google_test_url" → O usuário quer testar a URL OAuth diretamente.
      "financial_help" → O usuário faz uma pergunta geral relacionada a finanças (ex: investimentos, poupança, estratégias).
      "create_inventory_template" -> O usuário quer criar um novo tipo de produto para o estoque. Extraia o nome do template.
      "add_product_to_inventory" -> O usuário quer adicionar um novo item a um estoque existente. Extraia o nome do template.
      "list_inventory_templates" -> O usuário quer ver todos os tipos de estoque que ele já criou.
      "update_inventory_quantity" -> O usuário quer registrar uma entrada ou saída de um produto no estoque. Extraia a quantidade e o ID do produto.
      "view_inventory" -> O usuário quer listar os produtos de um estoque específico. Extraia o nome do template.
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
      - Se a pergunta envolver **"receitas"**, **"ganhos"** ou **"de onde veio"** e pedir um gráfico → use "generate_income_category_chart".
        Ex: "gráfico dos meus ganhos", "de onde vieram minhas receitas nos últimos 10 dias".
  
  4. Formato de Resposta:
       Responda apenas com um objeto JSON válido sem qualquer formatação ou explicação adicional
     - Retorne um objeto JSON com a intenção e dados extraídos. Use este formato:
       {
         "intent": "add_income" | "add_expense" | "add_transaction_new_category" | "add_installment_expense" | "delete_transaction" | "delete_list_item" | "generate_daily_chart" | "generate_category_chart" | "generate_income_category_chart" | "get_total_income" |"get_total" | "get_active_installments" | "greeting" | "instructions" | "reminder" | "delete_reminder" | "get_total_reminders" | "google_connect" | "google_disconnect" | "google_status" | "google_enable_sync" | "google_disable_sync" | "google_debug" | "financial_help" | "create_inventory_template" | "add_product_to_inventory" | "list_inventory_templates" | "update_inventory_quantity" | "view_inventory" ,
         "data": {
           "amount": number,
           "description": string,
           "category": string,
           "templateName": string,
           "quantity": number,     
           "productId": string, 
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
    - Usuário: "me mostre um gráfico das minhas receitas"
      Resposta: { "intent": "generate_income_category_chart", "data": { "days": 30}}

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

    - Usuário: "Conectar Google Calendar"
      Resposta: { "intent": "google_connect", "data": {} }
    - Usuário: "Quero sincronizar com Google"
      Resposta: { "intent": "google_connect", "data": {} }
    - Usuário: "Conectar minha conta Google"
      Resposta: { "intent": "google_connect", "data": {} }

    - Usuário: "Desconectar Google Calendar"
      Resposta: { "intent": "google_disconnect", "data": {} }
    - Usuário: "Parar sincronização Google"
      Resposta: { "intent": "google_disconnect", "data": {} }

    - Usuário: "Status do Google Calendar"
      Resposta: { "intent": "google_status", "data": {} }
    - Usuário: "Está conectado com Google?"
      Resposta: { "intent": "google_status", "data": {} }

    - Usuário: "Habilitar sincronização Google"
      Resposta: { "intent": "google_enable_sync", "data": {} }
    - Usuário: "Ativar Google Calendar"
      Resposta: { "intent": "google_enable_sync", "data": {} }

    - Usuário: "Desabilitar sincronização Google"
      Resposta: { "intent": "google_disable_sync", "data": {} }
    - Usuário: "Desativar Google Calendar"
      Resposta: { "intent": "google_disable_sync", "data": {} }

    - Usuário: "Debug Google Calendar"
      Resposta: { "intent": "google_debug", "data": {} }
    - Usuário: "Diagnóstico Google"
      Resposta: { "intent": "google_debug", "data": {} }

    - Usuário: "Devo investir mais em ações ou renda fixa?"
      Resposta: { "intent": "financial_help", "data": {} }

    - Usuário: "criar estoque de camisetas"
      Resposta: { "intent": "create_inventory_template", "data": { "templateName": "camisetas" } }
    - Usuário: "novo estoque para bebidas"
      Resposta: { "intent": "create_inventory_template", "data": { "templateName": "bebidas" } }

    - Usuário: "adicionar camiseta"
      Resposta: { "intent": "add_product_to_inventory", "data": { "templateName": "camiseta" } }
    - Usuário: "quero adicionar uma nova bebida"
      Resposta: { "intent": "add_product_to_inventory", "data": { "templateName": "bebida" } }
      
    - Usuário: "quais estoques eu tenho?"
      Resposta: { "intent": "list_inventory_templates", "data": {} }
    - Usuário: "listar estoques"
      Resposta: { "intent": "list_inventory_templates", "data": {} }
      
    - Usuário: "ver estoque de livros"
      Resposta: { "intent": "view_inventory", "data": { "templateName": "livros" } }
    - Usuário: "me mostre minhas camisetas em estoque"
      Resposta: { "intent": "view_inventory", "data": { "templateName": "camisetas" } }
    
    - Usuário: "entrada 10 #P0001"
      Resposta: { "intent": "update_inventory_quantity", "data": { "quantity": 10, "productId": "P0001" } }
    - Usuário: "saída de 3 #P0002"
      Resposta: { "intent": "update_inventory_quantity", "data": { "quantity": -3, "productId": "P0002" } }
    - Usuário: "vendi 1 #p0003"
      Resposta: { "intent": "update_inventory_quantity", "data": { "quantity": -1, "productId": "p0003" } }
    - Usuário: "adicionei 50 unidades ao item #P0004"
      Resposta: { "intent": "update_inventory_quantity", "data": { "quantity": 50, "productId": "P0004" } }
     
  
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

export async function interpretDocumentWithAI(imageUrl) {
  const prompt = `Você é um especialista em analisar IMAGENS de documentos financeiros brasileiros. Sua primeira tarefa é CLASSIFICAR o tipo de documento. Depois, extrair os dados relevantes.

  **1. CLASSIFICAÇÃO:**
  Determine o tipo do documento. Os tipos possíveis são:
  - 'store_receipt': Nota fiscal de compra (supermercado, loja, restaurante, etc.).
  - 'utility_bill': Conta de consumo com data de vencimento (luz, água, internet, boleto em geral).
  - 'pix_receipt': Comprovante de transação PIX.
  - 'unknown': Qualquer outro tipo de documento que não se encaixe nos anteriores.

  **2. EXTRAÇÃO DE DADOS (Baseado no tipo):**

  **Se o tipo for 'store_receipt':**
  - **totalAmount**: Extraia o valor final pago. Use a lógica de prioridade: "Valor a Pagar" > Valor na linha da "Forma de Pagamento" > "Valor Total".
  - **storeName**: Extraia o nome do estabelecimento.
  - **purchaseDate**: Extraia a data da compra.
  - **category**: Sugira uma categoria apropriada (ex: Supermercado -> "Alimentação").

  **Se o tipo for 'utility_bill':**
  - **totalAmount**: Extraia o valor principal da conta (Total a Pagar).
  - **provider**: Extraia o nome da empresa fornecedora (ex: "ENEL", "CLARO S.A.").
  - **dueDate**: Extraia a DATA DE VENCIMENTO.
  - **category**: A categoria deve ser "Gastos Fixos".

  **Se o tipo for 'pix_receipt':**
  - **totalAmount**: Extraia o valor do PIX.
  - **counterpartName**: Extraia o nome do beneficiário (para quem foi pago) ou do pagador (de quem recebeu). É o nome da "outra ponta" da transação.
  - **transactionDate**: Extraia a data em que o PIX foi efetivado.
  - **category**: A categoria deve ser "Transferência".

  **REGRAS GERAIS:**
  - Todas as datas devem ser retornadas no formato YYYY-MM-DD.
  - Converta sempre a VÍRGULA decimal brasileira para PONTO (ex: "445,79" se torna 445.79).
  - Responda APENAS com o objeto JSON final, sem explicações.

  **Formato de Resposta:**
  {
    "documentType": "store_receipt" | "utility_bill" | "pix_receipt" | "unknown",
    "data": {
      "totalAmount": 123.45,
      "storeName": "NOME DA LOJA", "purchaseDate": "2025-08-23", "category": "Alimentação",
      "provider": "NOME DA EMPRESA", "dueDate": "2025-09-10",
      "counterpartName": "NOME DO BENEFICIÁRIO/PAGADOR", "transactionDate": "2025-08-22"
    }
  }`;

  try {
    const imageResponse = await axios({
      method: 'get', url: imageUrl, responseType: 'arraybuffer',
      auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    });

    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const cleanResponse = response.choices[0].message.content.replace(/```json\n|```/g, "").trim();
    devLog("--- Resposta da IA (Análise de Documento) ---\n", cleanResponse, "\n-------------------------------------");
    const result = JSON.parse(cleanResponse);
    return result;

  } catch (error) {
    console.error("Erro no processo de interpretação de documento:", error);
    return { documentType: 'unknown', data: null };
  }
}