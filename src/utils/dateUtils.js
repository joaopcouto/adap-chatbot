import { formatInTimeZone } from 'date-fns-tz';
import ptBR from 'date-fns/locale/pt-BR';

// Fuso horário principal do Brasil. Usamos 'America/Sao_Paulo' pois ele lida com horário de verão.
export const TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata um objeto Date para uma string no fuso horário do Brasil.
 * @param {Date} date O objeto Date a ser formatado (que está em UTC).
 * @param {string} formatStr O formato desejado (padrão: 'dd/MM/yyyy').
 * @returns {string} A data formatada.
 */
export function formatInBrazil(date, formatStr = 'dd/MM/yyyy') {
  if (!date) return '';
  return formatInTimeZone(date, TIMEZONE, formatStr, { locale: ptBR });
}

/**
 * Formata um objeto Date para uma string de data e hora no fuso horário do Brasil.
 * @param {Date} date O objeto Date a ser formatado (que está em UTC).
 * @param {string} formatStr O formato desejado (padrão: 'dd/MM/yyyy HH:mm').
 * @returns {string} A data e hora formatada.
 */
export function formatDateTimeInBrazil(date, formatStr = 'dd/MM/yyyy HH:mm') {
    if (!date) return '';
    return formatInTimeZone(date, TIMEZONE, formatStr, { locale: ptBR });
}