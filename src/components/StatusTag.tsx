type Status = 'done' | 'pending' | 'voided' | 'open' | 'closed' | 'started' | 'suspended';

interface StatusTagProps {
  status: Status;
  children: string;
}

const statusStyles: Record<Status, string> = {
  done: 'bg-success-container text-on-success-container',
  pending: 'bg-warning-container text-on-warning-container',
  voided: 'bg-error-container text-on-error-container',
  open: 'bg-success-container text-on-success-container',
  closed: 'bg-surface-container-high text-on-surface-variant',
  started: 'bg-success-container text-on-success-container',
  suspended: 'bg-error-container text-on-error-container',
};

export function StatusTag({ status, children }: StatusTagProps) {
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-label-sm ${statusStyles[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
