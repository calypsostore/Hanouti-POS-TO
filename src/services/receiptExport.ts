import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

async function waitForReceiptFonts(): Promise<void> {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load('400 1em "Roboto Mono"'),
    document.fonts.load('700 1em "Roboto Mono"'),
  ]);
}

export async function printOrSharePdf(
  element: HTMLElement | null,
  filename: string,
  title: string,
  widthMillimetres: 58 | 80 = 80,
): Promise<void> {
  if (!element) throw new Error('The printable receipt is not available.');
  await waitForReceiptFonts();
  if (!Capacitor.isNativePlatform()) {
    const printStyle = document.createElement('style');
    printStyle.dataset.receiptPrintStyle = 'true';
    printStyle.textContent = `@media print {
      @page { size: ${widthMillimetres}mm auto; margin: 0; }
      html, body, #root { width: ${widthMillimetres}mm !important; }
      .receipt-print-target--active { --receipt-print-width: ${widthMillimetres}mm !important; }
    }`;
    document.head.append(printStyle);
    element.classList.add('receipt-print-target--active');
    const cleanup = () => {
      element.classList.remove('receipt-print-target--active');
      printStyle.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    return;
  }
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const heightMillimetres = canvas.height * widthMillimetres / canvas.width;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMillimetres, heightMillimetres],
    compress: true,
  });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMillimetres, heightMillimetres);

  const data = pdf.output('datauristring').split(',')[1];
  if (!data) throw new Error('Could not generate the receipt PDF.');
  const path = `${filename.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}.pdf`;
  const file = await Filesystem.writeFile({ path, data, directory: Directory.Cache });
  await Share.share({ title, dialogTitle: title, files: [file.uri] });
}

export async function downloadThermalPdf(
  element: HTMLElement | null,
  filename: string,
  title: string,
  widthMillimetres: 58 | 80,
): Promise<void> {
  const pdf = await createThermalPdf(element, widthMillimetres);
  await deliverPdf(pdf, filename, title, 'download');
}

export async function shareThermalPdf(
  element: HTMLElement | null,
  filename: string,
  title: string,
  widthMillimetres: 58 | 80,
): Promise<void> {
  const pdf = await createThermalPdf(element, widthMillimetres);
  await deliverPdf(pdf, filename, title, 'share');
}

async function createThermalPdf(element: HTMLElement | null, widthMillimetres: 58 | 80) {
  if (!element) throw new Error('The receipt is not available for export.');
  await waitForReceiptFonts();
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const heightMillimetres = canvas.height * widthMillimetres / canvas.width;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMillimetres, heightMillimetres],
    compress: true,
  });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMillimetres, heightMillimetres);
  return pdf;
}

export async function downloadOrSharePdf(element: HTMLElement | null, filename: string, title: string): Promise<void> {
  if (!element) throw new Error('The report is not available for export.');
  await waitForReceiptFonts();
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = 190;
  const pageHeight = 277;
  const scale = pageWidth / canvas.width;
  const pagePixelHeight = Math.floor(pageHeight / scale);
  const pageCount = Math.ceil(canvas.height / pagePixelHeight);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const sourceY = pageIndex * pagePixelHeight;
    const sliceHeight = Math.min(pagePixelHeight, canvas.height - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('Could not prepare a report PDF page.');
    context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 10, 10, pageWidth, sliceHeight * scale);
  }

  await deliverPdf(pdf, filename, title, 'share-or-download');
}

export async function shareTextAsPdf(text: string, filename: string, title: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const normalizedText = text
    .replace(/[—–−]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[’‘]/g, "'")
    .replaceAll('×', 'x');
  const lines = pdf.splitTextToSize(normalizedText, 182) as string[];
  let y = 14;
  for (const line of lines) {
    if (y > 282) {
      pdf.addPage();
      y = 14;
    }
    pdf.text(line, 14, y);
    y += 6;
  }
  await deliverPdf(pdf, filename, title, 'share-or-download');
}

async function deliverPdf(
  pdf: import('jspdf').jsPDF,
  filename: string,
  title: string,
  action: 'download' | 'share' | 'share-or-download',
): Promise<void> {
  const safeFilename = filename.replace(/[^a-z0-9_-]/gi, '-');
  if (Capacitor.isNativePlatform()) {
    const data = pdf.output('datauristring').split(',')[1];
    if (!data) throw new Error('Could not generate the PDF.');
    const path = `${safeFilename}-${Date.now()}.pdf`;
    const file = await Filesystem.writeFile({ path, data, directory: Directory.Cache });
    await Share.share({ title, dialogTitle: title, files: [file.uri] });
    return;
  }

  if (action === 'download') {
    pdf.save(`${safeFilename}.pdf`);
    return;
  }
  const file = new File([pdf.output('blob')], `${safeFilename}.pdf`, { type: 'application/pdf' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return;
  }
  if (action === 'share') throw new Error('PDF sharing is not supported in this browser. Download the PDF instead.');
  pdf.save(`${safeFilename}.pdf`);
}
