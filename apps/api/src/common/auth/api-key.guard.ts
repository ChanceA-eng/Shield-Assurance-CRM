import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const provided = request.headers['x-api-key'];
    const expected = process.env.INTERNAL_API_KEY ?? 'dev-internal-key';

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Missing or invalid x-api-key header.');
    }

    return true;
  }
}
