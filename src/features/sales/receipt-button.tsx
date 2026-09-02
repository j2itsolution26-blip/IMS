'use client';

import * as React from 'react';
import { Printer, Receipt as ReceiptIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Receipt, type ReceiptData } from '@/features/pos/receipt';

/** "View receipt / Print receipt" for a past sale. */
export function ReceiptButton({ data }: { data: ReceiptData }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ReceiptIcon /> View receipt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="no-print">
            <DialogTitle>{data.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <Receipt data={data} />
          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer /> Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
