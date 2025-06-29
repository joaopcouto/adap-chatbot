import { format, formatInTimeZone } from "date-fns-tz";
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
