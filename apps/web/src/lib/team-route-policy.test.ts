import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TEAM_API_ROUTE_POLICIES, teamApiRoutePolicy } from './team-route-policy';

async function routeMethods(directory: string, relative = ''): Promise<Array<{ route: string; methods: string[] }>> {
  const result: Array<{ route: string; methods: string[] }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await routeMethods(path.join(directory, entry.name), `${relative}/${entry.name}`));
    else if (entry.name === 'route.ts') {
      const source = ts.createSourceFile(entry.name, await readFile(path.join(directory, entry.name), 'utf8'), ts.ScriptTarget.Latest, true);
      const methods: string[] = [];
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          methods.push(...statement.exportClause.elements.map((element) => element.name.text));
        } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          if (ts.isFunctionDeclaration(statement) && statement.name) methods.push(statement.name.text);
          else if (ts.isVariableStatement(statement)) methods.push(...statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []));
        }
      }
      result.push({ route: relative, methods: methods.filter((method) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method)) });
    }
  }
  return result;
}

describe('Explicit team API permission coverage', () => {
  it('classifies every actual exported method, including re-exported handlers, without stale grants', async () => {
    const actual = await routeMethods(path.resolve('src', 'app', 'api'));
    const expected = new Set(actual.flatMap((entry) => entry.methods.map((method) => `${entry.route}:${method}`)));
    const registered = new Set(TEAM_API_ROUTE_POLICIES.flatMap((entry) => Object.keys(entry.methods).map((method) => `${entry.route}:${method}`)));
    expect([...expected].filter((key) => !registered.has(key))).toEqual([]);
    expect([...registered].filter((key) => !expected.has(key))).toEqual([]);
  }, 15000);

  it('does not authorize unknown paths or methods and gives exact routes precedence over IDs', () => {
    expect(teamApiRoutePolicy('/api/sales-templates/new-export', 'GET')).toBeNull();
    expect(teamApiRoutePolicy('/api/clients', 'PUT')).toBeNull();
    expect(teamApiRoutePolicy('/api/unknown-feature', 'GET')).toBeNull();
    expect(teamApiRoutePolicy('/api/leads/stats', 'HEAD')).toEqual({ kind: 'permission', permissions: ['leads.view'], recordScoped: true });
    expect(teamApiRoutePolicy('/api/tasks/bulk-reschedule', 'GET')).toBeNull();
    expect(teamApiRoutePolicy('/api/clients/example/files/example/download', 'GET'))
      .toEqual({ kind: 'permission', permissions: ['documents.view'], recordScoped: true });
  });

  it('requires command-specific guards for mixed-action and aggregate endpoints', () => {
    for (const route of ['/api/agency', '/api/sales-templates', '/api/social-marketing/engine', '/api/tasks']) {
      expect(teamApiRoutePolicy(route, 'POST')?.kind).toBe('handler');
    }
    expect(teamApiRoutePolicy('/api/shell', 'GET')).toEqual({ kind: 'handler', handler: 'shell' });
  });
});
