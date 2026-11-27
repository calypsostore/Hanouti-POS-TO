import { describe, expect, it } from 'vitest';
import { getLanguage, setDeviceLoginLanguage } from '../src/i18n';
import { ticketTranslations } from '../src/i18n/tickets';
import { buildReportDocument } from '../src/services/reportDocument';
import { buildKitchenTicketDocument, buildTicketDocument } from '../src/services/ticketDocument';
import type { OrderRecord, ReportRecord } from '../src/types/domain';

const order: OrderRecord = {
  id: 'order-1',
  number: 42,
  storeId: 'store-1',
  staffId: 'staff-1',
  staffName: 'Cashier',
  shiftId: 'shift-1',
  status: 'done',
  paymentMethod: 'cash',
  items: [{
    itemId: 'item-1',
    name: 'Coffee',
    quantity: 1,
    unitPriceMillimes: 1500,
    lineTotalMillimes: 1500,
    modifiers: [],
  }],
  totalMillimes: 1500,
  createdAt: '2026-11-20T20:00:00.000Z',
};

const report: ReportRecord = {
  id: 'report-1',
  storeId: 'store-1',
  type: 'X',
  businessDate: '2026-11-20',
  createdAt: '2026-11-20T20:00:00.000Z',
  salesMillimes: 1500,
  orderCount: 1,
  cashDifferenceMillimes: 0,
};

describe('ticket and report translations', () => {
  it('keeps ticket translation keys and interpolation placeholders aligned', () => {
    const keys = Object.keys(ticketTranslations.en).sort();
    expect(Object.keys(ticketTranslations.fr).sort()).toEqual(keys);
    expect(Object.keys(ticketTranslations.ar).sort()).toEqual(keys);

    for (const key of keys as Array<keyof typeof ticketTranslations.en>) {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(ticketTranslations.fr[key]), `French placeholders for ${key}`)
        .toEqual(placeholders(ticketTranslations.en[key]));
      expect(placeholders(ticketTranslations.ar[key]), `Arabic placeholders for ${key}`)
        .toEqual(placeholders(ticketTranslations.en[key]));
    }
  });

  it('renders order tickets and X reports in the selected language', () => {
    const previousLanguage = getLanguage();
    try {
      for (const [language, expectedTicket, expectedKitchen, expectedReport, expectedZReport] of [
        ['fr', 'Ticket n° 42', 'COPIE CUISINE N° 42', 'RAPPORT X', 'RAPPORT Z'],
        ['ar', 'التذكرة رقم 42', 'نسخة المطبخ رقم 42', 'تقرير X', 'تقرير Z'],
      ] as const) {
        setDeviceLoginLanguage(language);
        const ticket = buildTicketDocument(order, { name: 'Test Store' }, 'Cashier');
        const kitchenTicket = buildKitchenTicketDocument(order, { name: 'Test Store' }, 'Cashier');
        const reportDocument = buildReportDocument(report, { name: 'Test Store' });
        const zReportDocument = buildReportDocument({ ...report, type: 'Z' }, { name: 'Test Store' });

        expect(ticket.lines.map((line) => line.text).join('\n')).toContain(expectedTicket);
        expect(ticket.lines.map((line) => line.text).join('\n')).toContain(language === 'fr' ? 'ESPÈCES' : 'نقداً');
        expect(kitchenTicket.lines.map((line) => line.text).join('\n')).toContain(expectedKitchen);
        expect(reportDocument.title).toBe(expectedReport);
        expect(zReportDocument.title).toBe(expectedZReport);
        expect(reportDocument.sections.some((section) => section.title === (language === 'fr' ? 'VENTES' : 'المبيعات'))).toBe(true);
        expect(zReportDocument.sections.at(-1)?.lines[4].label)
          .toBe(language === 'fr' ? 'ESPÈCES ATTENDUES' : 'النقد المتوقع');
        expect(zReportDocument.lines.map((line) => line.text).join('\n')).not.toContain('EXPECTED CASH');
      }
    } finally {
      setDeviceLoginLanguage(previousLanguage);
    }
  });
});
