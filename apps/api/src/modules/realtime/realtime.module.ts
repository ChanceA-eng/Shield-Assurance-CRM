import { Module } from '@nestjs/common';
import { ActivityGateway } from './activity.gateway.js';

@Module({
  providers: [ActivityGateway],
  exports: [ActivityGateway],
})
export class RealtimeModule {}
