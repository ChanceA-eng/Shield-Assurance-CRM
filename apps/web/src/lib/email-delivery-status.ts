interface DeliveryEvent { type: string; occurred_at: string }

export function strongestDeliveryEvent(events: DeliveryEvent[]): DeliveryEvent | undefined {
  const rank = ['sent', 'delivery_delayed', 'failed', 'delivered', 'bounced', 'suppressed', 'complained'];
  return events.filter((event) => rank.includes(event.type.replace('email.', ''))).sort((a, b) => {
    const priority = rank.indexOf(b.type.replace('email.', '')) - rank.indexOf(a.type.replace('email.', ''));
    return priority || Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
  })[0];
}

export function emailReceiptTimes(events: DeliveryEvent[]): {
  delivered_at: string | null; first_open_at: string | null; last_open_at: string | null;
} {
  const opens = events.filter((event) => event.type === 'email.opened')
    .map((event) => event.occurred_at).sort((a, b) => Date.parse(a) - Date.parse(b));
  const deliveries = events.filter((event) => event.type === 'email.delivered')
    .map((event) => event.occurred_at).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { delivered_at: deliveries[0] ?? null, first_open_at: opens[0] ?? null, last_open_at: opens.at(-1) ?? null };
}
