/*
export function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null; 

    let formatted = phoneNumber.replace(/\s+/g, "").trim();
    if (!formatted.startsWith("whatsapp:")) {
      formatted = `whatsapp:${formatted}`;
    }
    return formatted;
  }  */

  export function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return null;
  }

  // 1. Remove o prefixo 'whatsapp:' se já existir para evitar duplicação.
  let cleanNumber = phoneNumber.replace('whatsapp:', '');

  // 2. Remove todos os caracteres que não são dígitos, exceto um '+' inicial.
  cleanNumber = cleanNumber.replace(/[^\d+]/g, '');

  // 3. Garante que o número comece com o código do país (+55)
  if (cleanNumber.startsWith('+55')) {
    // Já está correto, não faz nada
  } else if (cleanNumber.startsWith('55')) {
    // Falta o '+', adiciona
    cleanNumber = `+${cleanNumber}`;
  } else {
    // Falta o '+55', adiciona
    cleanNumber = `+55${cleanNumber}`;
  }

  // 4. Retorna a string final com o prefixo correto do WhatsApp.
  return `whatsapp:${cleanNumber}`;
}