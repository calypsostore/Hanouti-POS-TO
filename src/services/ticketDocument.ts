import type { OrderRecord, StoreSettings } from '../types/domain';
import { resolveStoreSettings } from '../types/domain';
import type { ReceiptLine, ThermalReceiptDocument } from './reportDocument';
import { formatReceiptRow } from './reportDocument';
import { formatTnd } from '../lib/format';
import { getLogoSrc } from '../data/logoCatalog';
import { formatTicketDateTime, formatTicketPaymentMethod, ticketT } from '../i18n/tickets';

const money = (amount: number) => `${formatTnd(amount / 1000)} DT`;
const widthChars = (width: 58 | 80) => width === 58 ? 32 : 48;
export function buildTicketDocument(
  order: OrderRecord,
  store: { name: string; address?: string; phone?: string; taxId?: string },
  staffName: string,
  settings?: Partial<StoreSettings>,
): ThermalReceiptDocument {
  const resolved = resolveStoreSettings(settings);
  const width = resolved.paperWidth;
  const ticketNumber = order.syncStatus ? `LOCAL-${Math.abs(order.number)}` : String(order.number);
  const lines: ReceiptLine[] = [
    { text: store.name, align: 'center', bold: true, size: 'double' },
    ...resolved.ticketHeaderText.map((text) => ({ text, align: 'center' as const })),
    ...(resolved.showAddress && store.address ? [{ text: store.address, align: 'center' as const }] : []),
    ...(resolved.showPhone && store.phone ? [{ text: store.phone, align: 'center' as const }] : []),
    ...(store.taxId ? [{ text: `${ticketT('Tax ID')}: ${store.taxId}`, align: 'center' as const }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    { text: ticketT('Ticket #{number}', { number: ticketNumber }), bold: true },
    ...(order.syncStatus ? [{ text: ticketT('PROVISIONAL LOCAL TICKET - NOT SERVER-CONFIRMED OR FISCALIZED'), bold: true }] : []),
    ...(resolved.showDateTime ? [{ text: formatTicketDateTime(order.createdAt) }] : []),
    ...(resolved.showStaffName ? [{ text: ticketT('Staff: {name}', { name: order.staffName ?? staffName }) }] : []),
    ...(order.location ? [{ text: ticketT('Location: {location}', { location: order.location }) }] : []),
    ...(order.syncStatus === 'queued' ? [{ text: ticketT('QUEUED - awaiting sync'), bold: true }] : []),
    ...(order.syncStatus === 'needs_attention' ? [{ text: ticketT('NEEDS ATTENTION - order was not synced'), bold: true }] : []),
    ...(order.verificationStatus === 'to_verify' ? [{ text: ticketT('Customer credit to verify'), bold: true }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...(order.status === 'voided' ? [{ text: ticketT('VOIDED'), align: 'center' as const, bold: true, size: 'double' as const }] : []),
    ...order.items.flatMap((item) => [
      { text: item.name, bold: true },
      { text: formatReceiptRow(`${item.quantity} x ${money(item.unitPriceMillimes)}`, money(item.lineTotalMillimes), width) },
      ...item.modifiers.map((modifier) => ({ text: `  + ${modifier}` })),
    ]),
    ...(order.note ? [{ text: ticketT('Order note'), bold: true }, { text: order.note }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...(order.fiscalSnapshot ? [
      { text: formatReceiptRow(ticketT('HT'), money(order.fiscalSnapshot.netAmountMillimes), width) },
      ...order.fiscalSnapshot.lines.flatMap((line) => line.taxes
        .filter((tax) => tax.taxType === 'vat')
        .map((tax) => ({
          text: formatReceiptRow(
            tax.ratePpm !== undefined
              ? ticketT('VAT {rate}', { rate: `${(tax.ratePpm / 10_000).toFixed(2).replace(/\.?0+$/, '')}%` })
              : ticketT('VAT'),
            money(tax.amountMillimes),
            width,
          ),
        }))),
      { text: formatReceiptRow(ticketT('TTC'), money(order.fiscalSnapshot.totalAmountMillimes), width) },
      { text: '-'.repeat(widthChars(width)), kind: 'divider' as const },
    ] : []),
    { text: formatReceiptRow(ticketT('TOTAL'), money(order.totalMillimes), width), bold: true, size: 'double' },
    { text: formatReceiptRow(ticketT('Payment'), formatTicketPaymentMethod(order.paymentMethod), width) },
    ...(order.status === 'voided' ? [
      { text: ticketT('Reason: {reason}', { reason: order.voidReason ?? ticketT('Not recorded') }) },
      { text: ticketT('Voided by: {name}', { name: order.voidedBy ?? ticketT('Not recorded') }) },
    ] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...resolved.ticketFooterText.map((text) => ({ text, align: 'center' as const, kind: 'footer' as const })),
  ];
  return {
    title: ticketT('Ticket #{number}', { number: ticketNumber }),
    width,
    logoSrc: resolved.showLogo ? getLogoSrc(resolved.storeLogoId) : undefined,
    lines,
  };
}

export function buildKitchenTicketDocument(
  order: OrderRecord,
  store: { name: string },
  staffName: string,
  settings?: Partial<StoreSettings>,
): ThermalReceiptDocument {
  const resolved = resolveStoreSettings(settings);
  const width = resolved.paperWidth;
  const ticketNumber = order.syncStatus ? `LOCAL-${Math.abs(order.number)}` : String(order.number);
  const lines: ReceiptLine[] = [
    { text: store.name, align: 'center', bold: true, size: 'double' },
    ...resolved.ticketHeaderText.map((text) => ({ text, align: 'center' as const })),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    { text: ticketT('KITCHEN COPY #{number}', { number: ticketNumber }), align: 'center', bold: true, size: 'double' },
    ...(order.syncStatus ? [{ text: ticketT('PROVISIONAL LOCAL TICKET - NOT SERVER-CONFIRMED OR FISCALIZED'), align: 'center' as const, bold: true }] : []),
    ...(resolved.showDateTime ? [{ text: formatTicketDateTime(order.createdAt) }] : []),
    ...(resolved.showStaffName ? [{ text: ticketT('Staff: {name}', { name: order.staffName ?? staffName }) }] : []),
    ...(order.location ? [{ text: ticketT('Location: {location}', { location: order.location }), bold: true }] : []),
    ...(order.syncStatus === 'queued' ? [{ text: ticketT('QUEUED - awaiting sync'), bold: true }] : []),
    ...(order.syncStatus === 'needs_attention' ? [{ text: ticketT('NEEDS ATTENTION - order was not synced'), bold: true }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...(order.status === 'voided'
      ? [
        { text: ticketT('VOIDED - DO NOT PREPARE'), align: 'center' as const, bold: true, size: 'double' as const },
        { text: ticketT('Reason: {reason}', { reason: order.voidReason ?? ticketT('Not recorded') }) },
      ]
      : order.items.flatMap((item) => [
        { text: `${item.quantity} x ${item.name}`, bold: true, size: 'double' as const },
        ...item.modifiers.map((modifier) => ({ text: `  + ${modifier}` })),
      ])),
    ...(order.status !== 'voided' && order.note?.trim()
      ? [{ text: '-'.repeat(widthChars(width)), kind: 'divider' as const }, { text: ticketT('NOTE: {note}', { note: order.note }), bold: true }]
      : []),
  ];
  return {
    title: ticketT('Kitchen Copy #{number}', { number: ticketNumber }),
    width,
    logoSrc: resolved.showLogo ? getLogoSrc(resolved.storeLogoId) : undefined,
    lines,
  };
}
