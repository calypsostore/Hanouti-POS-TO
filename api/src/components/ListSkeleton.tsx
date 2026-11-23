interface ListSkeletonProps {
  rows?: number;
  label?: string;
}

export function ListSkeleton({ rows = 3, label = 'Loading list' }: ListSkeletonProps) {
  return (
    <div className="list-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="list-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  );
}
