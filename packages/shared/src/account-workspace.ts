export type RecordType = 'lead' | 'client';
export interface RecordTarget {
  type: RecordType;
  id: string;
}

export type AssetKind = 'vehicle' | 'property' | 'equipment' | 'driver' | 'general';
export type AssetSource = 'client_reported' | 'agent_verified' | 'website' | 'import' | 'government';

export interface AssetDetails {
  year?: string;
  make?: string;
  model?: string;
  vin?: string;
  vehicle_type?: string;
  ownership?: string;
  use?: string;
  address?: string;
  mileage?: string;
  drivers?: string;
  occupancy?: string;
  construction?: string;
  roof?: string;
  value?: string;
  serial_number?: string;
  description?: string;
  license_state?: string;
  relationship?: string;
  notes?: string;
}

export interface AssetField {
  key: keyof AssetDetails;
  label: string;
  placeholder?: string;
}

export const ASSET_LABELS: Record<AssetKind, string> = {
  vehicle: 'Vehicle / truck',
  property: 'Property / business location',
  equipment: 'Equipment / trailer',
  driver: 'Driver',
  general: 'Other asset',
};

export const ASSET_FIELDS: Record<AssetKind, AssetField[]> = {
  vehicle: [
    { key: 'year', label: 'Year' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'vin', label: 'VIN' },
    { key: 'vehicle_type', label: 'Vehicle type', placeholder: 'Car, pickup, box truck...' },
    { key: 'ownership', label: 'Ownership', placeholder: 'Owned, financed, leased...' },
    { key: 'use', label: 'Use', placeholder: 'Personal, commuting, deliveries...' },
    { key: 'address', label: 'Garaging address' },
    { key: 'mileage', label: 'Annual mileage' },
    { key: 'drivers', label: 'Assigned drivers' },
  ],
  property: [
    { key: 'address', label: 'Property address' },
    { key: 'use', label: 'Property use', placeholder: 'Primary home, rental, shop...' },
    { key: 'ownership', label: 'Ownership', placeholder: 'Owned, financed, leased...' },
    { key: 'occupancy', label: 'Occupancy' },
    { key: 'construction', label: 'Construction' },
    { key: 'roof', label: 'Roof type / age' },
    { key: 'value', label: 'Reported replacement value' },
  ],
  equipment: [
    { key: 'description', label: 'Description' },
    { key: 'serial_number', label: 'Serial number / VIN' },
    { key: 'ownership', label: 'Ownership' },
    { key: 'use', label: 'Use' },
    { key: 'value', label: 'Reported value' },
    { key: 'address', label: 'Storage location' },
  ],
  driver: [
    { key: 'relationship', label: 'Relationship / role' },
    { key: 'license_state', label: 'License state' },
    { key: 'drivers', label: 'Assigned vehicles' },
  ],
  general: [
    { key: 'description', label: 'Description' },
    { key: 'value', label: 'Reported value' },
    { key: 'address', label: 'Location' },
  ],
};

export const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  client_reported: 'Client reported',
  agent_verified: 'Agent verified',
  website: 'Website submitted',
  import: 'Imported',
  government: 'Government record',
};

export interface WorkspaceAsset {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  title: string;
  asset_type: string;
  value: string | null;
  metadata: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type NoteKind = 'general' | 'call' | 'underwriting' | 'service';
export interface WorkspaceNote {
  id: string;
  lead_id: string | null;
  client_id: string | null;
  content: string;
  note_type: NoteKind;
  pinned: boolean;
  author_name: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceTask {
  id: string;
  subject: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  kind: 'task' | 'reminder';
  related_type: string | null;
  related_id: string | null;
  related_name?: string | null;
  account_id: string | null;
  note_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === 'string' && Object.hasOwn(ASSET_LABELS, value);
}

export function isAssetSource(value: unknown): value is AssetSource {
  return typeof value === 'string' && Object.hasOwn(ASSET_SOURCE_LABELS, value);
}

export function isNoteKind(value: unknown): value is NoteKind {
  return value === 'general' || value === 'call' || value === 'underwriting' || value === 'service';
}

export function isRecordType(value: unknown): value is RecordType {
  return value === 'lead' || value === 'client';
}
