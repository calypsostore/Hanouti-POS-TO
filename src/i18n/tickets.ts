import { getLanguage } from './index';
import { arTickets } from './locales/ar/tickets';
import { enTickets } from './locales/en/tickets';
import { frTickets } from './locales/fr/tickets';
import type { PaymentMethod } from '../types/domain';

export type TicketTranslationKey = keyof typeof enTickets;
export type TicketTranslationValues = Record<string, string | number>;

const ticketCatalogs = {
  en: enTickets,
  fr: frTickets,
  ar: arTickets,
} satisfies Record<ReturnType<typeof getLanguage>, Record<TicketTranslationKey, string>>;

const dateLocales = {
  en: 'en-US',
  fr: 'fr-FR',
  ar: 'ar-TN',
} as const;

export function ticketT(key: TicketTranslationKey, values: TicketTranslationValues = {}): string {
  const template = ticketCatalogs[getLanguage()][key] ?? enTickets[key];
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export function formatTicketDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(dateLocales[getLanguage()]);
}

export function formatTicketPaymentMethod(method: PaymentMethod): string {
  switch (method) {
    case 'cash': return ticketT('CASH');
    case 'card': return ticketT('CARD');
    case 'other': return ticketT('OTHER');
    case 'tab': return ticketT('TAB');
  }
}

export function getTicketDateLocale(): string {
  return dateLocales[getLanguage()];
}

export const ticketTranslations = ticketCatalogs;
