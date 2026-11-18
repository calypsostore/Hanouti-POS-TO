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
