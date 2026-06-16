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
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({
  namespace: '/fluency',
  cors: {
    origin: '*', // Tighten to ALLOWED_ORIGINS in production
    credentials: true,
  },
})
export class FluencyGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(FluencyGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth as Record<string, string>)['token'] ||
        (client.handshake.query['token'] as string);

      if (!token) {
        throw new UnauthorizedException('Missing JWT token');
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = this.jwtService.verify<{ sub: string; role: string }>(
        token,
        { secret },
      );

      client.data['userId'] = payload.sub;
      client.data['role'] = payload.role;

      this.logger.log(
        `Fluency WS connected: ${client.id} (user: ${payload.sub})`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Auth failed';
      this.logger.warn(`Fluency WS connection rejected: ${msg}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Fluency WS disconnected: ${client.id}`);
  }

  /**
   * Teacher joins the room for a class to receive live fluency-complete events.
   * Verifies the requester is a ClassTeacher before allowing the join.
   */
  @SubscribeMessage('join-class')
  async handleJoinClass(
    @MessageBody() data: { classId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ event: string; room: string } | { event: string; error: string }> {
    const userId = client.data['userId'] as string;

    try {
      const classTeacher = await this.prisma.classTeacher.findFirst({
        where: {
          class_id: data.classId,
          teacher_id: userId,
          deleted_at: null,
        },
      });

      if (!classTeacher) {
        return { event: 'error', error: 'Not a teacher of this class' };
      }

      const room = `class:${data.classId}`;
      await client.join(room);
      this.logger.log(`User ${userId} joined fluency room ${room}`);
      return { event: 'joined', room };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`join-class error: ${msg}`);
      return { event: 'error', error: 'Failed to join room' };
    }
  }

  /**
   * Called by FluencyAnalysisJob when analysis completes.
   * Emits to the class room so the teacher's UI updates in real time.
   */
  emitFluencyComplete(
    classId: string,
    payload: {
      assessmentId: string;
      studentId: string;
      fluencyScore: number;
      wpm: number;
      accuracy: number;
      status: string;
    },
  ): void {
    const room = `class:${classId}`;
    this.server.to(room).emit('fluency-complete', payload);
    this.logger.debug(
      `Emitted fluency-complete to room ${room} for assessment ${payload.assessmentId}`,
    );
  }
}
