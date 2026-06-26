import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server } from 'socket.io';

export interface ActivityBroadcastEvent {
  id: string;
  type: 'EMAIL' | 'SMS' | 'CALL' | 'SYSTEM_NOTE';
  message: string;
  at: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ActivityGateway {
  @WebSocketServer()
  private readonly server!: Server;

  publishActivity(event: ActivityBroadcastEvent): void {
    this.server.emit('activity:new', event);
  }
}
