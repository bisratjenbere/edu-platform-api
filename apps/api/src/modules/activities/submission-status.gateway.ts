import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  namespace: '/submissions',
  cors: {
    origin: '*', // Configure based on ALLOWED_ORIGINS env var in production
    credentials: true,
  },
})
export class SubmissionStatusGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SubmissionStatusGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from query param
      const token = client.handshake.query.token as string;

      if (!token) {
        throw new UnauthorizedException('Missing JWT token');
      }

      // Verify JWT
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      // Store user info in socket data
      client.data.userId = payload.sub;
      client.data.role = payload.role;

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch (error: any) {
      this.logger.warn(`Connection rejected: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinActivity')
  handleJoinActivity(
    @MessageBody() data: { activityId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = `activity:${data.activityId}`;
    client.join(roomName);
    this.logger.log(
      `User ${client.data.userId} joined room ${roomName}`,
    );
    return { event: 'joined', room: roomName };
  }

  @SubscribeMessage('leaveActivity')
  handleLeaveActivity(
    @MessageBody() data: { activityId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = `activity:${data.activityId}`;
    client.leave(roomName);
    this.logger.log(
      `User ${client.data.userId} left room ${roomName}`,
    );
    return { event: 'left', room: roomName };
  }

  // Called by SubmissionsService when status changes
  emitSubmissionUpdate(
    activityId: string,
    data: {
      submissionId: string;
      studentId: string;
      status: string;
      updatedAt: Date;
    },
  ) {
    const roomName = `activity:${activityId}`;
    this.server.to(roomName).emit('submission-updated', {
      submissionId: data.submissionId,
      studentId: data.studentId,
      activityId,
      status: data.status,
      updatedAt: data.updatedAt,
    });
    this.logger.debug(
      `Emitted submission-updated to room ${roomName}`,
    );
  }
}
