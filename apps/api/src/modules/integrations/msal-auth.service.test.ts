import { describe, expect, it } from 'vitest';
import { MsalAuthService } from './msal-auth.service.js';

describe('MsalAuthService', () => {
  it('builds a tenant authorize URL', () => {
    process.env.AZURE_TENANT_ID = 'tenant-id';
    process.env.AZURE_CLIENT_ID = 'client-id';
    process.env.AZURE_REDIRECT_URI = 'http://localhost:4000/callback';

    const service = new MsalAuthService();
    const url = service.getAuthorizationUrl();

    expect(url).toContain('tenant-id');
    expect(url).toContain('client-id');
    expect(url).toContain('oauth2/v2.0/authorize');
  });
});
