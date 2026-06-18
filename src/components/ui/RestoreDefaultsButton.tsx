import { RotateCcw } from 'lucide-react';
import { Button } from './Button';

interface RestoreDefaultsButtonProps {
  label: string;
  onRestore: () => void;
  className?: string;
}

/**
 * Small ghost button that restores a section's tunable assumptions back to their
 * data-based defaults. Used next to assumption inputs (growth rates, tax rates,
 * pension, employer cost) so a user who over-tunes can get the researched values back.
 */
export function RestoreDefaultsButton({ label, onRestore, className = '' }: RestoreDefaultsButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      leadingIcon={<RotateCcw />}
      className={className}
      onClick={onRestore}
    >
      {label}
    </Button>
  );
}
