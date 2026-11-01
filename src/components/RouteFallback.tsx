import { useFinance } from '../context/FinanceContext';
import { Skeleton } from './ui/Skeleton';

export default function RouteFallback() {
  const { t } = useFinance();
  // Page-shaped skeleton: title, a row of stat tiles, then a large chart block —
  // the layout most routes settle into, so first paint doesn't flash a blank box.
  return (
    <div className="space-y-4" role="status" aria-label={t.loading}>
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
