import Link from 'next/link';
import { CheckCircle2, CircleAlert, ArrowRight, ShieldCheck } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { gmailConfigured } from '../../lib/email-adapter';
import AutomationHealth from '../../components/crm/AutomationHealth';

export const dynamic = 'force-dynamic';

export default function SettingsPage(): JSX.Element {
  const integrations = [
    { title: 'Website intake', ready: Boolean(process.env.WEBSITE_SYNC_TOKEN), detail: 'Website submissions and daily reconciliation.' },
    { title: 'Outbound email', ready: gmailConfigured() || Boolean(process.env.SENDGRID_API_KEY), detail: 'Gmail or SendGrid credentials detected only; delivery is verified when sending.' },
    { title: 'Inbound email', ready: Boolean(process.env.INBOUND_WEBHOOK_SECRET), detail: 'SendGrid Inbound Parse and its MX record must also be configured externally.' },
    { title: 'Inbound text messages', ready: Boolean(process.env.TWILIO_AUTH_TOKEN), detail: 'The Twilio number must forward incoming messages to the SMS webhook.' },
    { title: 'Scheduled jobs', ready: Boolean(process.env.CRON_SECRET), detail: 'Cron authentication secret. Scheduling depends on the deployment configuration.' },
    { title: 'Optional AI drafts', ready: Boolean(process.env.OPENAI_API_KEY), detail: 'Drafting and analysis only. Core tasks and priorities do not need AI.' },
  ];
  return (
    <SectionLayout title="Release & Setup">
      <div className="mb-6 flex items-start gap-4 rounded-xl border border-cui-primary/25 bg-white p-5 shadow-card">
        <span className="rounded-xl bg-cui-primary/10 p-3 text-cui-primary"><ShieldCheck className="h-7 w-7" /></span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-cui-primary">Operational workspace</p>
          <h2 className="mt-1 text-xl font-bold text-cui-text">A focused CRM, with honest capability status</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-cui-muted">Work from Leads, Accounts and Tasks. Unfinished accounting, commission and administration tools are not presented as working features.</p>
        </div>
      </div>
      <div className="mb-5"><AutomationHealth /></div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>Integration configuration</CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-cui-muted">Presence of configuration is not a connectivity or delivery test. No credential values are displayed.</p>
            <div className="divide-y divide-cui-border/50">
              {integrations.map((item) => (
                <div key={item.title} className="flex items-start gap-3 py-4">
                  {item.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cui-success" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                  <div className="min-w-0 flex-1"><p className="font-semibold text-cui-text">{item.title}</p><p className="mt-1 text-sm text-cui-muted">{item.detail}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.ready ? 'bg-cui-success/15 text-green-800' : 'bg-cui-warning/20 text-amber-800'}`}>{item.ready ? 'Key present' : 'Setup needed'}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <div className="space-y-5">
          <Card><CardHeader>What is not enabled</CardHeader><CardBody>
            <ul className="space-y-3 text-sm leading-6 text-cui-muted">
              <li>Automated carrier rating, binding and licensed form generation.</li>
              <li>Commission reconciliation and accounting.</li>
              <li>In-app role/MFA administration.</li>
              <li>Scheduled text delivery; logging a message is not sending it.</li>
            </ul>
          </CardBody></Card>
          <Card><CardHeader>Continue your work</CardHeader><CardBody>
            <div className="space-y-3">
              <Link href="/tasks" className="flex items-center justify-between text-sm font-semibold text-cui-primary">Open Tasks<ArrowRight className="h-4 w-4" /></Link>
              <Link href="/clients" className="flex items-center justify-between text-sm font-semibold text-cui-primary">Open Accounts<ArrowRight className="h-4 w-4" /></Link>
              <Link href="/rashi" className="flex items-center justify-between text-sm font-semibold text-cui-primary">Knowledge Center<ArrowRight className="h-4 w-4" /></Link>
            </div>
          </CardBody></Card>
        </div>
      </div>
    </SectionLayout>
  );
}
