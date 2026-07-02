export type SheetColumnType = 'text' | 'number' | 'currency' | 'url';
export type SheetFormula = 'line_total';
export type SheetCellValue = string | number | null;

export interface SheetColumn {
  key: string;
  label: string;
  type: SheetColumnType;
  formula?: SheetFormula;
}

export interface SheetRow {
  id: string;
  [key: string]: SheetCellValue;
}

export interface CustomSheetSummary {
  id: string;
  title: string;
  category: string;
  updatedAt: string;
  rowCount: number;
  columnCount: number;
}

export interface CustomSheetRecord extends CustomSheetSummary {
  columns: SheetColumn[];
  rows: SheetRow[];
  createdAt: string;
}

const SHEET_COLUMN_TYPES: SheetColumnType[] = ['text', 'number', 'currency', 'url'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSheetColumnKey(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || `column_${Math.random().toString(36).slice(2, 8)}`;
}

function buildRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlankSheetRow(columns: SheetColumn[]): SheetRow {
  const row: SheetRow = { id: buildRowId() };

  for (const column of columns) {
    row[column.key] = column.formula ? null : '';
  }

  return row;
}

export function getDefaultSheetColumns(): SheetColumn[] {
  return [
    { key: 'description', label: 'Item', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'unitCost', label: 'Unit Cost', type: 'currency' },
    { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'total', label: 'Line Total', type: 'currency', formula: 'line_total' },
    { key: 'notes', label: 'Notes', type: 'text' },
  ];
}

export function buildDefaultSheetRecord(): Pick<CustomSheetRecord, 'title' | 'category' | 'columns' | 'rows'> {
  const columns = getDefaultSheetColumns();
  return {
    title: 'Untitled Expense Sheet',
    category: 'Expenses',
    columns,
    rows: [createBlankSheetRow(columns), createBlankSheetRow(columns), createBlankSheetRow(columns)],
  };
}

export function parseNumericCellValue(value: SheetCellValue): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function computeSheetFormulaValue(row: SheetRow, column: SheetColumn): number {
  if (column.formula !== 'line_total') {
    return parseNumericCellValue(row[column.key]);
  }

  return parseNumericCellValue(row.unitCost) * parseNumericCellValue(row.quantity);
}

function normalizeSheetCellValue(value: unknown, column: SheetColumn): SheetCellValue {
  if (column.formula) {
    return null;
  }

  if (column.type === 'number' || column.type === 'currency') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return '';
      }

      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : '';
    }

    return '';
  }

  return typeof value === 'string' ? value : '';
}

export function normalizeSheetColumns(input: unknown): SheetColumn[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenKeys = new Set<string>();
  const normalized: SheetColumn[] = [];

  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }

    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    const rawKey = typeof entry.key === 'string' ? entry.key.trim() : '';
    const type = typeof entry.type === 'string' && SHEET_COLUMN_TYPES.includes(entry.type as SheetColumnType)
      ? (entry.type as SheetColumnType)
      : 'text';
    const formula = entry.formula === 'line_total' ? 'line_total' : undefined;
    const key = createSheetColumnKey(rawKey || rawLabel || `column_${normalized.length + 1}`);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    normalized.push({
      key,
      label: rawLabel || rawKey || `Column ${normalized.length + 1}`,
      type,
      formula,
    });
  }

  return normalized;
}

export function normalizeSheetRows(input: unknown, columns: SheetColumn[]): SheetRow[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: SheetRow[] = [];

  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }

    const row: SheetRow = {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : buildRowId(),
    };

    for (const column of columns) {
      row[column.key] = normalizeSheetCellValue(entry[column.key], column);
    }

    normalized.push(row);
  }

  return normalized;
}

export function buildSheetSummary(sheet: {
  id: string;
  title: string;
  category: string;
  updatedAt: Date | string;
  columns: SheetColumn[];
  rows: SheetRow[];
}): CustomSheetSummary {
  return {
    id: sheet.id,
    title: sheet.title,
    category: sheet.category,
    updatedAt: new Date(sheet.updatedAt).toISOString(),
    rowCount: sheet.rows.length,
    columnCount: sheet.columns.length,
  };
}