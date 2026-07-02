import { Suspense } from 'react';
import CommercialIntakeClient from './CommercialIntakeClient';

export default function CommercialIntakePage(): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#6a6a6a]">Loading commercial intake...</div>}>
      <CommercialIntakeClient />
    </Suspense>
  );
}
