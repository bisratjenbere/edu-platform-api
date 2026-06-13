import {
  Injectable,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CleverProfile } from './clever-api.service';
import { Role, User } from '@prisma/client';

@Injectable()
export class CleverService {
  private readonly logger = new Logger(CleverService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Handle Clever OAuth callback - upsert/link user only.
   * Session tokens are issued later via POST /auth/oauth/exchange.
   */
  async handleCallback(
    profile: CleverProfile,
  ): Promise<{ user: User; isNew: boolean }> {
    this.logger.log(`Clever callback for user: ${profile.id} (${profile.email})`);

    // 1. Look up user by clever_id first (returning user)
    let user = await this.prisma.user.findFirst({
      where: {
        clever_id: profile.id,
        deleted_at: null,
      },
      include: { school: true },
    });

    let isNew = false;

    // 2. Fall back to email lookup (first Clever login on existing account)
    if (!user && profile.email) {
      user = await this.prisma.user.findFirst({
        where: {
          email: profile.email,
          deleted_at: null,
        },
        include: { school: true },
      });

      if (user) {
        // Link the existing account to Clever
        this.logger.log(`Linking existing user ${user.id} to Clever ID ${profile.id}`);
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { clever_id: profile.id },
          include: { school: true },
        });
      }
    }

    // 3. If nothing found, create new user
    if (!user) {
      // For new users, we need to determine the school
      // In production, this would be determined from Clever's school field
      // For now, we'll require school_id to be provided or use a default
      
      if (!profile.school) {
        throw new BadRequestException(
          'Cannot create user: no school information provided by Clever',
        );
      }

      // Map Clever type to EduFlow Role
      const role = this.mapCleverTypeToRole(profile.type);

      // Note: In production, profile.school would need to be mapped to an EduFlow school_id
      // For this implementation, we'll need to query the school by clever_school_id or similar
      // For now, throwing an error as this requires additional school mapping logic
      
      throw new BadRequestException(
        'New user creation via Clever requires school mapping - not yet implemented',
      );

      // Future implementation would look like:
      // const school = await this.prisma.school.findFirst({
      //   where: { clever_school_id: profile.school, deleted_at: null }
      // });
      // if (!school) throw new ForbiddenException('School not found or Clever not enabled');
      
      // user = await this.prisma.user.create({
      //   data: {
      //     email: profile.email,
      //     clever_id: profile.id,
      //     first_name: profile.name.first,
      //     last_name: profile.name.last,
      //     role,
      //     school_id: school.id,
      //   },
      //   include: { school: true },
      // });
      // isNew = true;
    }

    // 4. Verify school has clever_enabled = true
    if (!user.school) {
      throw new ForbiddenException('User has no associated school');
    }

    if (!user.school.clever_enabled) {
      throw new ForbiddenException('Clever SSO is not enabled for your school');
    }

    // 5. Update name if changed
    const nameChanged =
      user.first_name !== profile.name.first ||
      user.last_name !== profile.name.last;

    if (nameChanged) {
      this.logger.log(`Updating name for user ${user.id}`);
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          first_name: profile.name.first,
          last_name: profile.name.last,
        },
        include: { school: true },
      });
    }

    if (!user.is_active) {
      throw new ForbiddenException('Authentication failed');
    }

    return { user, isNew };
  }

  /**
   * Map Clever user type to EduFlow Role
   */
  private mapCleverTypeToRole(cleverType: string): Role {
    switch (cleverType) {
      case 'teacher':
        return Role.TEACHER;
      case 'student':
        return Role.STUDENT;
      case 'district_admin':
        return Role.DISTRICT_ADMIN;
      default:
        this.logger.warn(`Unknown Clever type: ${cleverType}, defaulting to TEACHER`);
        return Role.TEACHER;
    }
  }
}
