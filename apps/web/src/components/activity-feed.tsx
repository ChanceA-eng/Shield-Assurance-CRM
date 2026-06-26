"use client";

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

interface FeedEvent {
  id: string;
  type: 'EMAIL' | 'SMS' | 'CALL' | 'SYSTEM_NOTE';
  message: string;
  at: string;
}

const seed: FeedEvent[] = [
  { id: 'a1', type: 'SYSTEM_NOTE', message: 'Mason Builders welcome kit dispatched.', at: '2m ago' },
  { id: 'a2', type: 'EMAIL', message: 'Renewal questions received from Pioneer Foods.', at: '7m ago' },
  { id: 'a3', type: 'SMS', message: 'Fleet policy signature reminder delivered.', at: '13m ago' },
];

export function ActivityFeed(): JSX.Element {
  const [events, setEvents] = useState<FeedEvent[]>(seed);

  useEffect(() => {
    let socket: Socket | undefined;

    try {
      socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000', { autoConnect: false });
      socket.connect();
      socket.on('activity:new', (event: FeedEvent) => {
        setEvents((prev) => [event, ...prev].slice(0, 25));
      });
    } catch {
      // Socket server may not be enabled in early setup.
    }

    return () => {
      socket?.disconnect();
    };
  }, []);

  return (
    <section className="rounded-2xl border border-white/75 bg-white/90 p-4 shadow-panel">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-[0.12em] text-tide">ABSOLUTE FEED</h3>
        <span className="rounded-lg bg-accent/15 px-2 py-1 text-xs font-semibold text-accent">Live</span>
      </header>
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="animate-riseIn rounded-xl border border-frost bg-base p-3">
            <p className="text-xs font-semibold text-tide">{event.type}</p>
            <p className="text-sm font-medium">{event.message}</p>
            <p className="text-xs text-ink/60">{event.at}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
