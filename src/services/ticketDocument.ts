import type { OrderRecord, StoreSettings } from '../types/domain';
import { resolveStoreSettings } from '../types/domain';
import type { ReceiptLine, ThermalReceiptDocument } from './reportDocument';
import { formatReceiptRow } from './reportDocument';
import { formatTnd } from '../lib/format';
import { getLogoSrc } from '../data/logoCatalog';

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
    ...(store.taxId ? [{ text: `Tax ID: ${store.taxId}`, align: 'center' as const }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    { text: `Ticket #${ticketNumber}`, bold: true },
    ...(resolved.showDateTime ? [{ text: new Date(order.createdAt).toLocaleString() }] : []),
    ...(resolved.showStaffName ? [{ text: `Staff: ${order.staffName ?? staffName}` }] : []),
    ...(order.location ? [{ text: `Location: ${order.location}` }] : []),
    ...(order.syncStatus === 'queued' ? [{ text: 'QUEUED - awaiting sync', bold: true }] : []),
    ...(order.syncStatus === 'needs_attention' ? [{ text: 'NEEDS ATTENTION - order was not synced', bold: true }] : []),
    ...(order.verificationStatus === 'to_verify' ? [{ text: 'Customer credit to verify', bold: true }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...(order.status === 'voided' ? [{ text: 'VOIDED', align: 'center' as const, bold: true, size: 'double' as const }] : []),
    ...order.items.flatMap((item) => [
      { text: item.name, bold: true },
      { text: formatReceiptRow(`${item.quantity} x ${money(item.unitPriceMillimes)}`, money(item.lineTotalMillimes), width) },
      ...item.modifiers.map((modifier) => ({ text: `  + ${modifier}` })),
    ]),
    ...(order.note ? [{ text: 'Order note', bold: true }, { text: order.note }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    { text: formatReceiptRow('TOTAL', money(order.totalMillimes), width), bold: true, size: 'double' },
    { text: formatReceiptRow('Payment', order.paymentMethod.toUpperCase(), width) },
    ...(order.status === 'voided' ? [
      { text: `Reason: ${order.voidReason ?? 'Not recorded'}` },
      { text: `Voided by: ${order.voidedBy ?? 'Not recorded'}` },
    ] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...resolved.ticketFooterText.map((text) => ({ text, align: 'center' as const, kind: 'footer' as const })),
  ];
  return {
    title: `Ticket #${ticketNumber}`,
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
    { text: `KITCHEN COPY #${ticketNumber}`, align: 'center', bold: true, size: 'double' },
    ...(resolved.showDateTime ? [{ text: new Date(order.createdAt).toLocaleString() }] : []),
    ...(resolved.showStaffName ? [{ text: `Staff: ${order.staffName ?? staffName}` }] : []),
    ...(order.location ? [{ text: `Location: ${order.location}`, bold: true }] : []),
    ...(order.syncStatus === 'queued' ? [{ text: 'QUEUED - awaiting sync', bold: true }] : []),
    ...(order.syncStatus === 'needs_attention' ? [{ text: 'NEEDS ATTENTION - order was not synced', bold: true }] : []),
    { text: '-'.repeat(widthChars(width)), kind: 'divider' },
    ...(order.status === 'voided'
      ? [
        { text: 'VOIDED - DO NOT PREPARE', align: 'center' as const, bold: true, size: 'double' as const },
        { text: `Reason: ${order.voidReason ?? 'Not recorded'}` },
      ]
      : order.items.flatMap((item) => [
        { text: `${item.quantity} x ${item.name}`, bold: true, size: 'double' as const },
        ...item.modifiers.map((modifier) => ({ text: `  + ${modifier}` })),
      ])),
    ...(order.status !== 'voided' && order.note?.trim()
      ? [{ text: '-'.repeat(widthChars(width)), kind: 'divider' as const }, { text: `NOTE: ${order.note}`, bold: true }]
      : []),
  ];
  return {
    title: `Kitchen Copy #${ticketNumber}`,
    width,
    logoSrc: resolved.showLogo ? getLogoSrc(resolved.storeLogoId) : undefined,
    lines,
  };
}
