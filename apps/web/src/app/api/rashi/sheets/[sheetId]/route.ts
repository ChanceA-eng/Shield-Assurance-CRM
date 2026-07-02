import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import {
  buildDefaultSheetRecord,
  buildSheetSummary,
  getDefaultSheetColumns,
  normalizeSheetColumns,
  normalizeSheetRows,
  type CustomSheetRecord,
  type SheetColumn,
  type SheetRow,
} from '../../../../../lib/rashi-sheets';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ sheetId: string }>;
}

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

function buildPersistedPayload(body: unknown, current: { title: string; category: string; columns: SheetColumn[]; rows: SheetRow[] }): {
  title: string;
  category: string;
  columns: Prisma.InputJsonValue;
  rows: Prisma.InputJsonValue;
} {
  const defaults = buildDefaultSheetRecord();
  const source = isRecord(body) ? body : {};
  const parsedColumns = normalizeSheetColumns(source.columns);
  const columns = parsedColumns.length > 0 ? parsedColumns : current.columns ?? defaults.columns;
  const parsedRows = normalizeSheetRows(source.rows, columns);
  const rows = parsedRows.length > 0 ? parsedRows : current.rows ?? defaults.rows;

  return {
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : current.title,
    category: typeof source.category === 'string' && source.category.trim() ? source.category.trim() : current.category,
    columns: columns as unknown as Prisma.InputJsonValue,
    rows: rows as unknown as Prisma.InputJsonValue,
  };
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { sheetId } = await context.params;
    const sheet = await prisma.customSheet.findUnique({
      where: { id: sheetId },
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

    if (!sheet) {
      return NextResponse.json({ message: 'Rashi sheet not found.' }, { status: 404 });
    }

    return NextResponse.json(serializeSheet(sheet), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load Rashi sheet.' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { sheetId } = await context.params;
    const existing = await prisma.customSheet.findUnique({
      where: { id: sheetId },
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

    if (!existing) {
      return NextResponse.json({ message: 'Rashi sheet not found.' }, { status: 404 });
    }

    const current = serializeSheet(existing);
    const body = await request.json().catch(() => ({}));
    const data = buildPersistedPayload(body, {
      title: current.title,
      category: current.category,
      columns: current.columns,
      rows: current.rows,
    });

    const updated = await prisma.customSheet.update({
      where: { id: sheetId },
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

    return NextResponse.json(serializeSheet(updated), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to save Rashi sheet.' },
      { status: 500 },
    );
  }
}