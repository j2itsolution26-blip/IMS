import { requirePermission } from '@/lib/session';
import { readRange } from '@/lib/report-range';
import { certificatesReport, collectionsReport } from '@/lib/reports';
import { peso } from '@/lib/format';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Reports' };

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission('reports.view');
  const sp = await searchParams;
  const range = readRange(sp.from, sp.to);
  const [col, cert] = await Promise.all([collectionsReport(range), certificatesReport(range)]);
  const qs = `from=${range.from}&to=${range.to}`;

  return (
    <>
      <PageHeader title="Reports" description="Collections and certificates for any period, up to one year. Export to CSV for Excel." />
      <form className="mb-6 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={range.from} className="input" />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={range.to} className="input" />
        </label>
        <button className="btn-secondary">Show</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total collected" value={peso(col.total)} />
        <Stat label="Paid receipts" value={col.receipts.length - col.cancelled} />
        <Stat label="Cancelled receipts" value={col.cancelled} />
        <Stat label="Certificates issued" value={cert.certs.filter((c) => c.status === 'ISSUED').length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Collections by day">
          <a href={`/api/reports/collections?${qs}`} className="btn-secondary mb-3">
            Download CSV
          </a>
          {col.byDay.length === 0 ? (
            <Empty>No collections in this period.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">Receipts</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {col.byDay.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td className="text-right tabular-nums">{d.count}</td>
                    <td className="text-right tabular-nums">{peso(d.total)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right tabular-nums">{col.receipts.length - col.cancelled}</td>
                  <td className="text-right tabular-nums">{peso(col.total)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {col.byNature.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold">By nature of collection</h3>
              <table className="table">
                <tbody>
                  {col.byNature.map((n) => (
                    <tr key={n.nature}>
                      <td>{n.nature}</td>
                      <td className="text-right tabular-nums">{n.count}</td>
                      <td className="text-right tabular-nums">{peso(n.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
        <Card title="Certificates by document">
          <a href={`/api/reports/certificates?${qs}`} className="btn-secondary mb-3">
            Download CSV
          </a>
          {cert.byType.length === 0 ? (
            <Empty>No certificates in this period.</Empty>
          ) : (
            <table className="table">
              <tbody>
                {cert.byType.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="text-right tabular-nums">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
