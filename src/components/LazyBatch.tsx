import { useEffect, useRef, useState, type ReactNode } from 'react';

interface LazyBatchProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  resetKey?: string;
  initial?: number;
  step?: number;
  className?: string;
  rootSelector?: string;
}

export function LazyBatch<T>({
  items,
  renderItem,
  resetKey = '',
  initial = 6,
  step = 6,
  className = '',
  rootSelector,
}: LazyBatchProps<T>) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(initial);

  useEffect(() => {
    setLimit(initial);
  }, [initial, resetKey]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || limit >= items.length) return;
    const root = rootSelector ? document.querySelector(rootSelector) : null;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLimit((current) => Math.min(current + step, items.length));
      }
    }, { root, rootMargin: '40px 0px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length, limit, rootSelector, step]);

  return (
    <>
      {items.slice(0, limit).map((item, index) => renderItem(item, index))}
      {limit < items.length && (
        <div ref={sentinel} className={`lazy-list-sentinel ${className}`} aria-hidden="true" />
      )}
    </>
  );
}
