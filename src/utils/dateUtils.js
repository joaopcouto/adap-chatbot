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
    case "today":
      periodName = "Hoje";
      endDate.setHours(23, 59, 59, 999);
      break;
    case "yesterday":
      periodName = "Ontem";
      startDate.setDate(startDate.getDate() - 1);
      endDate.setDate(endDate.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
      break;
    case "this_week":
      const currentDay = nowInBrazil.getDay();
      startDate.setDate(startDate.getDate() - currentDay);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const startFormatted = `${startDate
        .getDate()
        .toString()
        .padStart(2, "0")}/${(startDate.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;
      const endFormatted = `${endDate.getDate().toString().padStart(2, "0")}/${(
        endDate.getMonth() + 1
      )
        .toString()
        .padStart(2, "0")}`;

      periodName = `nesta Semana (de ${startFormatted} a ${endFormatted})`;

      break;
    case "last_week":
      const pastDay = nowInBrazil.getDay();
      startDate.setDate(startDate.getDate() - pastDay - 7);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const lastStartFormatted = `${startDate
        .getDate()
        .toString()
        .padStart(2, "0")}/${(startDate.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;
      const lastEndFormatted = `${endDate
        .getDate()
        .toString()
        .padStart(2, "0")}/${(endDate.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;

      periodName = `na Semana Passada (de ${lastStartFormatted} a ${lastEndFormatted})`;

      break;
    case "two_weeks_ago":
      const dayOfWeek = nowInBrazil.getDay();
      startDate.setDate(startDate.getDate() - dayOfWeek - 14);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const twoWeeksStart = `${startDate
        .getDate()
        .toString()
        .padStart(2, "0")}/${(startDate.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;
      const twoWeeksEnd = `${endDate.getDate().toString().padStart(2, "0")}/${(
        endDate.getMonth() + 1
      )
        .toString()
        .padStart(2, "0")}`;

      periodName = `na Semana Retrasada (de ${twoWeeksStart} a ${twoWeeksEnd})`;
      break;
  }
  return { startDate, endDate, periodName };
}
