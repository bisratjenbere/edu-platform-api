import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
@WebSocketGateway({
  namespace: '/messages',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  },
})
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MessagingGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from handshake auth
      const token = client.handshake.auth?.token;

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = payload.sub;

      // Join user-specific room
      await client.join(`user:${userId}`);

      // Store userId in socket data for later use
      client.data.userId = userId;

      this.logger.log(
        `Client ${client.id} connected and joined room user:${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Authentication failed for client ${client.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    this.logger.log(
      `Client ${client.id} disconnected from user:${userId || 'unknown'}`,
    );
  }

  // Method to emit new message to all participants in a thread
  async emitNewMessage(recipientIds: string[], payload: any) {
    for (const recipientId of recipientIds) {
      this.server.to(`user:${recipientId}`).emit('new-message', payload);
    }
  }
}
