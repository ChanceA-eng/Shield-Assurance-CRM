'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { TaskTimeliness } from '../../lib/task-timeliness';

export default function TaskTimelinessChart({ metrics }: { metrics: TaskTimeliness }): JSX.Element {
  const rows = [{ name: 'Completed on time', value: metrics.on_time, color: '#4dbd74' },
    { name: 'Overdue / completed late', value: metrics.overdue, color: '#f86c6b' },
    { name: 'Open / not overdue', value: metrics.open, color: '#73818f' },
    { name: 'Timing unknown', value: metrics.unclassified, color: '#c8ced3' }];
  return <div>
    <p className="text-center text-sm font-semibold">Completed: {metrics.completed}</p>
    <div className="h-52" role="img" aria-label={`Task timing: ${metrics.on_time} completed on time, ${metrics.overdue} overdue or completed late, ${metrics.open} open and not overdue, ${metrics.unclassified} timing unknown`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={rows} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="80%" animationDuration={1500}>
          {rows.map((row) => <Cell key={row.name} fill={row.color} />)}
        </Pie><Tooltip /></PieChart>
      </ResponsiveContainer>
    </div>
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {rows.map((row) => <span key={row.name} className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />{row.name}: {row.value}
      </span>)}
    </div>
    {metrics.unclassified > 0 ? <p className="mt-2 text-center text-xs text-cui-muted">{metrics.unclassified} task{metrics.unclassified === 1 ? ' lacks' : 's lack'} reliable timing.</p> : null}
  </div>;
}
