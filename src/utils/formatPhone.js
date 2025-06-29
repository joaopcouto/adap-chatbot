export function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null; 

    let formatted = phoneNumber.replace(/\s+/g, "").trim();
    if (!formatted.startsWith("whatsapp:")) {
      formatted = `whatsapp:${formatted}`;
    }
    return formatted;
  }  