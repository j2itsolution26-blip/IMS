'use client';

import { Button } from '@/components/ui/button';

/**
 * Sticky save bar for the settings form.
 *
 * Rendered only while there is something to save, so it never covers the page
 * when the form is clean. It sits in the form's own flow (sticky, not fixed),
 * so the last card is never hidden beneath it, and it clears the phone's home
 * indicator through the safe-area inset.
 */
export function SettingsActionBar({
  changes,
  saving,
  onCancel,
}: {
  changes: number;
  saving: boolean;
  onCancel: () => void;
}) {
  if (changes === 0 && !saving) return null;

  return (
    <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
      <div
        role="region"
        aria-label="Unsaved changes"
        className="flex flex-col gap-3 rounded-card border bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center sm:justify-between sm:pl-5"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          {saving
            ? 'Saving changes…'
            : `${changes} unsaved change${changes === 1 ? '' : 's'}`}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button type="button" variant="outline" className="h-10 sm:h-9" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="h-10 sm:h-9" loading={saving}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
