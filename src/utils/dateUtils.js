import { formatInTimeZone, toZonedTime } from "date-fns-tz";
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

export function getDateRangeFromPeriod(period) {
  const nowInBrazil = toZonedTime(new Date(), TIMEZONE);
  
  nowInBrazil.setHours(0, 0, 0, 0);

  let startDate = new Date(nowInBrazil);
  let endDate = new Date(nowInBrazil);
  let periodName = "";

  switch (period) {
    case 'today':
      periodName = "Hoje";
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      periodName = "Ontem";
      startDate.setDate(startDate.getDate() - 1);
      endDate.setDate(endDate.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'this_week':
      const currentDay = nowInBrazil.getDay(); // 0=Domingo
      startDate.setDate(startDate.getDate() - currentDay);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      
      const startFmt = formatInBrazil(startDate, 'dd/MM');
      const endFmt = formatInBrazil(endDate, 'dd/MM');
      periodName = `nesta Semana (de ${startFmt} a ${endFmt})`;
      break;
    case 'last_week':
      const pastDay = nowInBrazil.getDay();
      startDate.setDate(startDate.getDate() - pastDay - 7); 
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const lastStartFmt = formatInBrazil(startDate, 'dd/MM');
      const lastEndFmt = formatInBrazil(endDate, 'dd/MM');
      periodName = `na Semana Passada (de ${lastStartFmt} a ${lastEndFmt})`;
      break;
  }
  return { startDate, endDate, periodName };
}
