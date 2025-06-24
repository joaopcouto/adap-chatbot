import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export async function generateChart(expenses, userId, days) {
  return new Promise((resolve, reject) => {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, "_");

    const tempFilePath = path.join("/tmp", `temp_expenses_${sanitizedUserId}.json`);
    const outputImagePath = path.join("/tmp", `report_${sanitizedUserId}.png`);

    // 🚀 Salvar o JSON para o Python ler
    fs.writeFileSync(tempFilePath, JSON.stringify(expenses, null, 2));

    if (!fs.existsSync(tempFilePath)) {
      console.error("❌ Erro: O JSON não foi salvo corretamente.");
      reject("Erro ao salvar o JSON.");
      return;
    }

    console.log("✅ JSON salvo:", tempFilePath);

    const pythonCommand = process.platform === "win32" ? "python" : "python3";

    const script = spawn(pythonCommand, [
      "generate_chart.py",
      tempFilePath,
      outputImagePath,
      days.toString()
    ]);

    let imageUrl = "";
    let errorOutput = "";

    script.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log("📤 Saída do Python:", output);

      // Se for uma URL válida, armazenar
      if (output.startsWith("http")) {
        imageUrl = output;
      }
    });

    script.stderr.on("data", (data) => {
      const error = data.toString();
      errorOutput += error;
      console.error("❌ Erro do Python:", error);
    });

    script.on("exit", (code) => {
      console.log("🚪 Script Python finalizado com código:", code);
      console.log("🗑️ Limpando arquivos temporários...");

      try {
        fs.unlinkSync(tempFilePath);
        // fs.unlinkSync(outputImagePath); // opcional
      } catch (err) {
        console.warn("⚠️ Erro ao remover arquivos temporários:", err.message);
      }

      if (imageUrl) {
        resolve(imageUrl);
      } else {
        // Se errorOutput tiver conteúdo, usamos ele. Senão, uma mensagem padrão.
        const finalError = errorOutput || "Ocorreu um erro ao gerar a imagem.";
        reject(finalError); // Rejeita a promise com a mensagem do Python!
      }
    });
  });
}

export async function generateCategoryChart(expenses, userId) {
  return new Promise((resolve, reject) => {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, "_");

    const tempFilePath = path.join("/tmp", `temp_category_${sanitizedUserId}.json`);
    const outputImagePath = path.join("/tmp", `category_report_${sanitizedUserId}.png`);

    fs.writeFileSync(tempFilePath, JSON.stringify(expenses, null, 2));

    if (!fs.existsSync(tempFilePath)) {
      console.error("❌ Erro: O JSON não foi salvo corretamente.");
      reject("Erro ao salvar o JSON.");
      return;
    }

    console.log("✅ JSON salvo:", tempFilePath);

    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const script = spawn(pythonCommand, [
      "generate_category_chart.py",
      tempFilePath,
      outputImagePath,
    ]);

    let imageUrl = "";
script.stdout.on("data", (data) => {
  const output = data.toString().trim();
  console.log("📊 Caminho da imagem gerada:", output);

  if (output.startsWith("http")) {
    imageUrl = output;
  }
});

script.on("exit", () => {
  fs.unlinkSync(tempFilePath);
  if (imageUrl) {
    resolve(imageUrl);
  } else {
    reject("Erro ao gerar ou obter URL da imagem.");
  }
});


    script.stderr.on("data", (data) => {
      console.error("❌ Erro no Python:", data.toString());
      reject("Erro na execução do Python: " + data.toString());
    });

    script.on("exit", () => {
      console.log("🗑️ Removendo JSON temporário...");
      // fs.unlinkSync(tempFilePath);
    });
  });
}