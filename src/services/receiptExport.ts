import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function printOrSharePdf(element: HTMLElement | null, filename: string, title: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.print();
    return;
  }
  if (!element) throw new Error('The printable receipt is not available.');

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const widthMillimetres = 80;
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

export async function downloadOrSharePdf(element: HTMLElement | null, filename: string, title: string): Promise<void> {
  if (!element) throw new Error('The report is not available for export.');
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

  if (Capacitor.isNativePlatform()) {
    const data = pdf.output('datauristring').split(',')[1];
    if (!data) throw new Error('Could not generate the report PDF.');
    const path = `${filename.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}.pdf`;
    const file = await Filesystem.writeFile({ path, data, directory: Directory.Cache });
    await Share.share({ title, dialogTitle: title, files: [file.uri] });
    return;
  }

  const file = new File([pdf.output('blob')], `${filename}.pdf`, { type: 'application/pdf' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return;
  }
  pdf.save(`${filename}.pdf`);
}

export async function shareElementImage(element: HTMLElement | null, filename: string, title: string): Promise<void> {
  if (!element) throw new Error('The report is not available for image export.');
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });

  if (Capacitor.isNativePlatform()) {
    const data = canvas.toDataURL('image/png').split(',')[1];
    if (!data) throw new Error('Could not generate the report image.');
    const path = `${filename.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}.png`;
    const file = await Filesystem.writeFile({ path, data, directory: Directory.Cache });
    await Share.share({ title, dialogTitle: title, files: [file.uri] });
    return;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Could not generate the report image.'));
    }, 'image/png');
  });
  const file = new File([blob], `${filename}.png`, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
