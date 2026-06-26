"use client";

import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type { DealStage } from '@crm/shared';

const stages: DealStage[] = ['LEAD', 'QUOTING', 'PRESENTED', 'BOUND', 'LOST'];

interface DealCard {
  id: string;
  title: string;
  value: number;
  stage: DealStage;
  insured: string;
}

const seedDeals: DealCard[] = [
  { id: 'd1', title: 'Fleet Liability', value: 124000, stage: 'LEAD', insured: 'Northstar Hauling' },
  { id: 'd2', title: 'Workers Compensation', value: 86000, stage: 'QUOTING', insured: 'Pioneer Foods' },
  { id: 'd3', title: 'Commercial Auto', value: 149500, stage: 'PRESENTED', insured: 'Blue Anchor HVAC' },
  { id: 'd4', title: 'General Liability', value: 102300, stage: 'BOUND', insured: 'Mason Builders' },
];

export function KanbanBoard(): JSX.Element {
  const [cards, setCards] = useState<DealCard[]>(seedDeals);
  const sensors = useSensors(useSensor(PointerSensor));

  const grouped = useMemo(() => {
    return stages.reduce<Record<DealStage, DealCard[]>>((acc, stage) => {
      acc[stage] = cards.filter((card) => card.stage === stage);
      return acc;
    }, {} as Record<DealStage, DealCard[]>);
  }, [cards]);

  const onDragEnd = async (event: DragEndEvent) => {
    const dealId = String(event.active.id);
    const destination = event.over?.id as DealStage | undefined;
    if (!destination || !stages.includes(destination)) {
      return;
    }

    const current = cards.find((card) => card.id === dealId);
    if (!current || current.stage === destination) {
      return;
    }

    const previousStage = current.stage;
    setCards((prev) => prev.map((card) => (card.id === dealId ? { ...card, stage: destination } : card)));

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/deals/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? 'dev-internal-key',
          'x-user-role': 'MANAGER',
        },
        body: JSON.stringify({ dealId, stage: destination, triggeredBy: 'agency.agent@shieldassurance.com' }),
      });
    } catch {
      // Roll back optimistic update when persistence fails.
      setCards((prev) => prev.map((card) => (card.id === dealId ? { ...card, stage: previousStage } : card)));
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-4 xl:grid-cols-5 md:grid-cols-3 sm:grid-cols-2">
        {stages.map((stage) => (
          <section key={stage} id={stage} className="rounded-2xl border border-white/75 bg-white/90 p-3 shadow-panel">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-[0.15em] text-tide">{stage}</h3>
              <span className="rounded-lg bg-frost px-2 py-1 text-xs font-semibold text-ink/70">{grouped[stage].length}</span>
            </header>
            <ul className="space-y-2">
              {grouped[stage].map((card) => (
                <li
                  key={card.id}
                  id={card.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData('text/plain');
                    if (!id) return;
                    void onDragEnd({
                      active: { id } as DragEndEvent['active'],
                      over: { id: stage } as DragEndEvent['over'],
                    } as DragEndEvent);
                  }}
                  className="animate-riseIn rounded-xl border border-frost bg-base p-3"
                >
                  <p className="text-sm font-semibold">{card.title}</p>
                  <p className="mt-1 text-xs text-ink/65">{card.insured}</p>
                  <p className="mt-2 text-sm font-bold text-tide">${card.value.toLocaleString()}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </DndContext>
  );
}
