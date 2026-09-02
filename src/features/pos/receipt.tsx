'use client';

import { formatCurrency, formatDateTime, formatQuantity } from '@/lib/format';

/**
 * Printable receipt.
 *
 * Rendered on screen inside the dialog and again for the printer via the
 * `no-print` / print rules in globals.css. Figures come from the completed
 * sale returned by the server, never from the till's local preview.
 */

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface ReceiptData {
  invoiceNumber: string;
  issuedAt: Date;
  cashierName: string;
  lines: ReceiptLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  payments: { method: string; amount: number }[];
  company: {
    name: string;
    address: string;
    phone: string;
    receiptFooter: string;
  };
  currency: string;
}

export function Receipt({ data }: { data: ReceiptData }) {
  const { company, currency } = data;

  return (
    <div className="mx-auto w-full max-w-[302px] rounded-md border bg-white p-4 font-mono text-[11px] leading-relaxed text-black">
      <header className="text-center">
        <p className="text-sm font-bold uppercase">{company.name}</p>
        {company.address && <p className="whitespace-pre-line">{company.address}</p>}
        {company.phone && <p>{company.phone}</p>}
      </header>

      <Divider />

      <div className="space-y-0.5">
        <Line label="Receipt" value={data.invoiceNumber} />
        <Line label="Date" value={formatDateTime(data.issuedAt)} />
        <Line label="Cashier" value={data.cashierName} />
      </div>

      <Divider />

      <table className="w-full">
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={`${line.name}-${index}`} className="align-top">
              <td colSpan={2} className="pb-1">
                <span className="block">{line.name}</span>
                <span className="flex justify-between">
                  <span>
                    {formatQuantity(line.quantity)} × {formatCurrency(line.unitPrice, currency)}
                    {line.discount > 0 && ` − ${formatCurrency(line.discount, currency)}`}
                  </span>
                  <span>{formatCurrency(line.total, currency)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />

      <div className="space-y-0.5">
        <Line label="Subtotal" value={formatCurrency(data.subtotal, currency)} />
        {data.tax > 0 && <Line label="Tax" value={formatCurrency(data.tax, currency)} />}
        {data.discount > 0 && <Line label="Discount" value={`− ${formatCurrency(data.discount, currency)}`} />}
      </div>

      <Divider />

      <p className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatCurrency(data.total, currency)}</span>
      </p>

      <Divider />

      <div className="space-y-0.5">
        {data.payments.map((payment, index) => (
          <Line key={index} label={payment.method} value={formatCurrency(payment.amount, currency)} />
        ))}
        {data.change > 0 && <Line label="Change" value={formatCurrency(data.change, currency)} />}
        {data.paid < data.total && (
          <Line label="Balance due" value={formatCurrency(data.total - data.paid, currency)} />
        )}
      </div>

      <Divider />

      <p className="text-center">{company.receiptFooter}</p>
      <p className="mt-1 text-center text-[10px]">
        {formatQuantity(data.lines.reduce((acc, line) => acc + line.quantity, 0))} item(s)
      </p>
    </div>
  );
}

function Divider() {
  return <p className="my-1.5 select-none overflow-hidden whitespace-nowrap">{'-'.repeat(42)}</p>;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </span>
  );
}
