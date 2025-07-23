export function fixPhoneNumber(phoneNumber) {
  const numberOnly = phoneNumber.replace("whatsapp:+", "");

  // Check if the number has 12 digits (one less than expected 13)
  if (numberOnly.length === 12) {
    // Insert '9' as the fifth character (after area code)
    return `${numberOnly.slice(0, 4)}9${numberOnly.slice(4)}`;
  }

  return numberOnly;
}
