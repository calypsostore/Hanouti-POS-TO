import { useEffect, useState } from 'react';

export function useFocusRefreshKey(): number {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshKey((current) => current + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  return refreshKey;
}
