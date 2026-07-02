import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import {
  buildDefaultSheetRecord,
  buildSheetSummary,
  getDefaultSheetColumns,
  normalizeSheetColumns,
  normalizeSheetRows,
  type CustomSheetRecord,
  type SheetColumn,
  type SheetRow,
} from '../../../../lib/rashi-sheets';

export const runtime = 'nodejs';
export const maxDuration = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeSheet(sheet: {
  id: string;
  title: string;
  category: string;
  columns: unknown;
  rows: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CustomSheetRecord {
  const parsedColumns = normalizeSheetColumns(sheet.columns);
  const columns = parsedColumns.length > 0 ? parsedColumns : getDefaultSheetColumns();
  const rows = normalizeSheetRows(sheet.rows, columns);
  const summary = buildSheetSummary({
    id: sheet.id,
    title: sheet.title,
    category: sheet.category,
    updatedAt: sheet.updatedAt,
    columns,
    rows,
  });

  return {
    ...summary,
    columns,
    rows,
    createdAt: sheet.createdAt.toISOString(),
  };
}

function buildPersistedPayload(body: unknown, current?: { title: string; category: string; columns: SheetColumn[]; rows: SheetRow[] }): {
  title: string;
  category: string;
  columns: Prisma.InputJsonValue;
  rows: Prisma.InputJsonValue;
} {
  const defaults = buildDefaultSheetRecord();
  const source = isRecord(body) ? body : {};
  const parsedColumns = normalizeSheetColumns(source.columns);
  const columns = parsedColumns.length > 0 ? parsedColumns : current?.columns ?? defaults.columns;
  const parsedRows = normalizeSheetRows(source.rows, columns);
  const rows = parsedRows.length > 0 ? parsedRows : current?.rows ?? defaults.rows;
  const title = typeof source.title === 'string' && source.title.trim()
    ? source.title.trim()
    : current?.title ?? defaults.title;
  const category = typeof source.category === 'string' && source.category.trim()
    ? source.category.trim()
    : current?.category ?? defaults.category;

  return {
    title,
    category,
    columns: columns as unknown as Prisma.InputJsonValue,
    rows: rows as unknown as Prisma.InputJsonValue,
  };
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const sheets = await prisma.customSheet.findMany({
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        category: true,
        columns: true,
        rows: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const payload = sheets.map((sheet) => buildSheetSummary(serializeSheet(sheet)));
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load Rashi sheets.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const data = buildPersistedPayload(body);
    const created = await prisma.customSheet.create({
      data,
      select: {
        id: true,
        title: true,
        category: true,
        columns: true,
        rows: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(serializeSheet(created), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create Rashi sheet.' },
      { status: 500 },
    );
  }
}