import { formatArizonaDateTime } from '../../lib/arizona-time';
import { receiptLabel, type EmailReceipt } from '../../lib/message-receipts';

export default function EmailOpenStatus({ receipt, status }: { receipt?: EmailReceipt; status?: string }): JSX.Element {
  const state = receipt?.status ?? status ?? '';
  const issue = ['failed', 'bounced', 'suppressed', 'complained', 'acceptance_unknown'].includes(state);
  return <div className="space-y-0.5 text-xs">
    {issue ? <p className="font-medium text-cui-danger">{receiptLabel(state)}</p> : null}
    {receipt?.first_open_at ? <p className="font-medium text-violet-800" title="Tracking image loaded. Privacy tools and automated scanners can trigger this; it does not confirm a human read.">
      Open detected · {formatArizonaDateTime(receipt.first_open_at)} AZ
      {receipt.last_open_at && receipt.last_open_at !== receipt.first_open_at ? <span className="block font-normal text-cui-muted">Last opened · {formatArizonaDateTime(receipt.last_open_at)} AZ</span> : null}
    </p> : <p className="text-cui-muted" title="No tracking event has been received. Image blocking can prevent open detection.">No open recorded</p>}
  </div>;
}
