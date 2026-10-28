'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { addSuggestedCategories } from '@/features/catalogue/actions';

/** Adds the suggested sari-sari categories the store does not have yet, after a confirmation listing them. */
export function SuggestedCategoriesButton({ missing }: { missing: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (missing.length === 0) return null;

  const onConfirm = async () => {
    if (busy) return;
    setBusy(true);
    const result = await addSuggestedCategories();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.added.length > 0
        ? `Added ${result.data.added.length} categor${result.data.added.length === 1 ? 'y' : 'ies'}.`
        : 'Your store already has all the suggested categories.',
    );
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ListPlus /> Add suggested categories
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Add ${missing.length} suggested categor${missing.length === 1 ? 'y' : 'ies'}?`}
        description={`${missing.join(', ')}. Categories you already have are left as they are, and you can rename or remove any of these later.`}
        confirmLabel="Add categories"
        loading={busy}
        onConfirm={onConfirm}
      />
    </>
  );
}
