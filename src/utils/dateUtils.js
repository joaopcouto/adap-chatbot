import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { parse, addDays, addHours, addMinutes, subMinutes, isAfter, isBefore, format } from "date-fns";
import ptBR from "date-fns/locale/pt-BR";

export const TIMEZONE = "America/Sao_Paulo";

export function formatInBrazil(date, formatStr = "dd/MM/yyyy") {
  if (!date) return "";
  return formatInTimeZone(date, TIMEZONE, formatStr, { locale: ptBR });
}

export function formatDateTimeInBrazil(date, formatStr = "dd/MM/yyyy HH:mm") {
  if (!date) return "";
  return formatInTimeZone(date, TIMEZONE, formatStr, { locale: ptBR });
}

export function formatInBrazilWithTime(date) {
  if (!date) return "";
  const formatStr = "dd/MM/yyyy HH:mm";
  const formattedDate = formatInTimeZone(date, TIMEZONE, formatStr, {
    locale: ptBR,
  });
  return formattedDate.replace(" ", " às ");
}

/**
 * Returns the current date and time in Brazil timezone
 * @returns {Date} Current date in Brazil timezone
 */
export function getCurrentDateInBrazil() {
  const now = new Date();
  return toZonedTime(now, TIMEZONE);
}


/**
 * Creates a reminder date from date and time strings, considering Brazil timezone
 * @param {string} dateString - Date string (e.g., "2024-01-15", "amanhã", "hoje", "2024-01-15T15:30:00.000Z")
 * @param {string} timeString - Time string (e.g., "15:30", "15h", "3:30 PM"). If not provided, defaults to 09:00
 * @returns {Date} Date object in Brazil timezone
 */
export function createReminderDate(dateString, timeString = null) {
  const currentBrazilDate = getCurrentDateInBrazil();
  let targetDate;

  // Check if dateString is an ISO datetime string (from AI interpretation)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(dateString)) {
    // Parse ISO datetime string but treat the time as Brazil local time, not UTC
    const isoDate = new Date(dateString);
    if (isNaN(isoDate.getTime())) {
      throw new Error(`Invalid ISO date format: ${dateString}`);
    }
    
    // Extract date and time components from the ISO string
    const year = isoDate.getUTCFullYear();
    const month = isoDate.getUTCMonth();
    const day = isoDate.getUTCDate();
    const hours = isoDate.getUTCHours();
    const minutes = isoDate.getUTCMinutes();
    const seconds = isoDate.getUTCSeconds();
    
    // Create a date in Brazil timezone with the same date/time values
    // This treats the time as local Brazil time, not UTC
    targetDate = new Date(currentBrazilDate);
    targetDate.setFullYear(year, month, day);
    targetDate.setHours(hours, minutes, seconds, 0);
    
    // Log the timezone conversion for debugging
    if (process.env.DEBUG_MODE_ENABLED === 'true' || process.env.ENHANCED_LOGGING_ENABLED === 'true') {
      console.log(`[DateUtils] ISO datetime converted: ${dateString} → ${targetDate.toLocaleString('pt-BR', { timeZone: TIMEZONE })}`);
    }
    
    return targetDate; // Return early since time is already included
  }

  // Handle relative dates
  const lowerDateString = dateString.toLowerCase().trim();
  
  if (lowerDateString === 'hoje') {
    targetDate = new Date(currentBrazilDate);
  } else if (lowerDateString === 'amanhã' || lowerDateString === 'amanha') {
    targetDate = addDays(currentBrazilDate, 1);
  } else {
    // Try to parse absolute date
    try {
      // Handle various date formats
      let parsedDate;
      
      // Try ISO format first (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        parsedDate = parse(dateString, 'yyyy-MM-dd', currentBrazilDate);
      }
      // Try Brazilian format (DD/MM/YYYY)
      else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
        parsedDate = parse(dateString, 'dd/MM/yyyy', currentBrazilDate);
      }
      // Try DD/MM format (assume current year)
      else if (/^\d{2}\/\d{2}$/.test(dateString)) {
        parsedDate = parse(dateString, 'dd/MM', currentBrazilDate);
      }
      else {
        throw new Error('Invalid date format');
      }
      
      targetDate = parsedDate;
    } catch (error) {
      throw new Error(`Invalid date format: ${dateString}. Use formats like: DD/MM/YYYY, DD/MM, YYYY-MM-DD, hoje, amanhã, or ISO datetime (2024-01-15T15:30:00.000Z)`);
    }
  }

  // Handle time parsing
  let hours = 9; // Default to 9 AM
  let minutes = 0;

  if (timeString) {
    const timeStr = timeString.toLowerCase().trim();
    
    // Handle formats like "15h", "15h30", "3h", "3h30"
    if (/^\d{1,2}h(\d{2})?$/.test(timeStr)) {
      const match = timeStr.match(/^(\d{1,2})h(\d{2})?$/);
      hours = parseInt(match[1]);
      minutes = match[2] ? parseInt(match[2]) : 0;
    }
    // Handle formats like "15:30", "3:30"
    else if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':');
      hours = parseInt(h);
      minutes = parseInt(m);
    }
    // Handle formats like "15", "3"
    else if (/^\d{1,2}$/.test(timeStr)) {
      hours = parseInt(timeStr);
      minutes = 0;
    }
    else {
      throw new Error(`Invalid time format: ${timeString}. Use formats like: 15:30, 15h30, 15h, or 15`);
    }

    // Validate hours and minutes
    if (hours < 0 || hours > 23) {
      throw new Error(`Invalid hour: ${hours}. Must be between 0 and 23`);
    }
    if (minutes < 0 || minutes > 59) {
      throw new Error(`Invalid minutes: ${minutes}. Must be between 0 and 59`);
    }
  }

  // Set the time
  targetDate.setHours(hours, minutes, 0, 0);

  return targetDate;
}

/**
 * Converts a Brazil timezone date to UTC for storage
 * @param {Date} brazilDate - Date in Brazil timezone
 * @returns {Date} Date converted to UTC
 */
export function convertToUTCForStorage(brazilDate) {
  if (!brazilDate || !(brazilDate instanceof Date)) {
    throw new Error('Invalid date provided for UTC conversion');
  }
  
  return fromZonedTime(brazilDate, TIMEZONE);
}

/**
 * Converts a UTC date to Brazil timezone for processing
 * @param {Date} utcDate - Date in UTC
 * @returns {Date} Date converted to Brazil timezone
 */
export function convertFromUTCForProcessing(utcDate) {
  if (!utcDate || !(utcDate instanceof Date)) {
    throw new Error('Invalid date provided for Brazil timezone conversion');
  }
  
  return toZonedTime(utcDate, TIMEZONE);
}

/**
 * Validates if an early reminder time is valid based on current time and buffer
 * @param {Date} mainReminderDate - Main reminder date in Brazil timezone
 * @param {number} earlyMinutes - Minutes before main reminder for early notification
 * @param {number} bufferMinutes - Buffer time in minutes (default: 5)
 * @returns {Object} Validation result with isValid, errorMessage, and suggestedBuffer
 */
export function validateEarlyReminderTime(mainReminderDate, earlyMinutes, bufferMinutes = 5) {
  if (!mainReminderDate || !(mainReminderDate instanceof Date)) {
    return {
      isValid: false,
      errorMessage: 'Data do lembrete principal é inválida'
    };
  }

  if (!earlyMinutes || earlyMinutes <= 0) {
    return {
      isValid: false,
      errorMessage: 'Tempo de antecedência deve ser maior que zero'
    };
  }

  if (earlyMinutes > 24 * 60) { // 24 hours in minutes
    return {
      isValid: false,
      errorMessage: 'Tempo de antecedência não pode ser maior que 24 horas'
    };
  }

  const currentBrazilDate = getCurrentDateInBrazil();
  const earlyReminderDate = subMinutes(mainReminderDate, earlyMinutes);
  const minimumValidTime = addMinutes(currentBrazilDate, bufferMinutes);

  if (isBefore(earlyReminderDate, minimumValidTime)) {
    const suggestedBuffer = Math.ceil((currentBrazilDate.getTime() - earlyReminderDate.getTime()) / (1000 * 60)) + bufferMinutes;
    
    return {
      isValid: false,
      errorMessage: `O lembrete antecipado seria enviado no passado. O horário atual é ${formatDateTimeInBrazil(currentBrazilDate)} e o lembrete antecipado seria às ${formatDateTimeInBrazil(earlyReminderDate)}. Tente um tempo menor de antecedência ou agende o lembrete para mais tarde.`,
      suggestedBuffer: Math.min(suggestedBuffer, earlyMinutes - 1)
    };
  }

  // Also validate that the main reminder is not in the past
  if (isBefore(mainReminderDate, currentBrazilDate)) {
    return {
      isValid: false,
      errorMessage: `O lembrete principal está agendado para o passado: ${formatDateTimeInBrazil(mainReminderDate)}. Horário atual: ${formatDateTimeInBrazil(currentBrazilDate)}`
    };
  }

  return {
    isValid: true
  };
}

/**
 * Parses relative date strings like "hoje", "amanhã" into actual dates
 * @param {string} relativeDateString - Relative date string
 * @param {Date} currentBrazilDate - Current date in Brazil timezone (optional, defaults to current)
 * @returns {Date} Parsed date in Brazil timezone
 */
export function parseRelativeDate(relativeDateString, currentBrazilDate = null) {
  const baseDate = currentBrazilDate || getCurrentDateInBrazil();
  const lowerDateString = relativeDateString.toLowerCase().trim();
  
  switch (lowerDateString) {
    case 'hoje':
      return new Date(baseDate);
    case 'amanhã':
    case 'amanha':
      return addDays(baseDate, 1);
    case 'depois de amanhã':
    case 'depois de amanha':
      return addDays(baseDate, 2);
    default:
      throw new Error(`Formato de data relativa não reconhecido: ${relativeDateString}`);
  }
}