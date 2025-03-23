export function formatPhoneNumber(userId) {
    let formatted = userId.replace(/\s+/g, "").trim();
    if (!formatted.startsWith("whatsapp:")) {
      formatted = `whatsapp:${formatted}`;
    }
    return formatted;
  }  