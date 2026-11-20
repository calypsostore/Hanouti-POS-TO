import { forwardRef } from 'react';
import type { ThermalReceiptDocument } from '../services/reportDocument';

export const ReceiptDocumentView = forwardRef<HTMLElement, {
  document: ThermalReceiptDocument;
  className?: string;
}>(function ReceiptDocumentView({ document, className = '' }, ref) {
  return (
    <article
      ref={ref}
      className={`receipt-print-target receipt-document-view receipt-width-${document.width} ${className}`.trim()}
      data-receipt-width={document.width}
    >
      {document.logoSrc && <img className="receipt-logo" src={document.logoSrc} alt="" />}
      <div className="receipt-document-lines">
        {document.lines.map((line, index) => (
          <div
            key={`${index}-${line.text}`}
            className={[
              'receipt-document-line',
              line.kind ? `receipt-line-${line.kind}` : '',
              line.bold ? 'receipt-line-bold' : '',
              line.size === 'double' ? 'receipt-line-double' : '',
              line.align ? `receipt-line-${line.align}` : '',
            ].filter(Boolean).join(' ')}
            dir="auto"
          >
            {line.text || '\u00a0'}
          </div>
        ))}
      </div>
    </article>
  );
});
