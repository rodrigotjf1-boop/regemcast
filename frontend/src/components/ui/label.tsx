import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  opcional?: boolean;
}

export function Label({ className, children, opcional = false, ...props }: LabelProps) {
  return (
    <label
      className={cn('flex items-baseline gap-2 text-sm font-medium text-tinta', className)}
      {...props}
    >
      {children}
      {opcional ? <span className="text-xs font-normal text-tinta-suave">opcional</span> : null}
    </label>
  );
}
