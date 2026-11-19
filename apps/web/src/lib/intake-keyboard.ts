import type { KeyboardEvent } from 'react';

export function preventImplicitIntakeSubmit(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement
    && !['submit', 'button', 'checkbox', 'radio'].includes(event.target.type)) event.preventDefault();
}
