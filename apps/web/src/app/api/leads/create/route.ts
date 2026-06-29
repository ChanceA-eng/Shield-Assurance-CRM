import { NextRequest, NextResponse } from 'next/server';
import { OPTIONS as leadsOptions, POST as leadsPost } from '../route';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return leadsPost(request);
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return leadsOptions(request);
}
