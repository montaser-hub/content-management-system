import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role, UserStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_FACING_SELECT = {
  id: true,
  email: true,
  role: true,
  requestedRole: true,
  status: true,
  approvedById: true,
  approvedAt: true,
  rejectionCount: true,
  lastRejectedAt: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(status?: UserStatus) {
    return this.prisma.user.findMany({
      where: status ? { status } : undefined,
      select: ADMIN_FACING_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_FACING_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /** Story 1 step 6: approve a pending registration and assign its role. */
  async approve(adminId: string, userId: string, role: Role) {
    const target = await this.getPendingOrThrow(userId);

    return this.prisma.user.update({
      where: { id: target.id },
      data: {
        role,
        status: 'ACTIVE',
        approvedById: adminId,
        approvedAt: new Date(),
      },
      select: ADMIN_FACING_SELECT,
    });
  }

  /**
   * Reject a pending registration. This is the only place rejectionCount and
   * lastRejectedAt are written — re-registration (AuthService.register)
   * reuses the row but leaves this history untouched, which is what makes it
   * a history rather than a value that resets every attempt.
   */
  async reject(userId: string) {
    const target = await this.getPendingOrThrow(userId);

    return this.prisma.user.update({
      where: { id: target.id },
      data: {
        status: 'REJECTED',
        role: null,
        rejectionCount: { increment: 1 },
        lastRejectedAt: new Date(),
      },
      select: ADMIN_FACING_SELECT,
    });
  }

  async updateRole(userId: string, role: Role) {
    const target = await this.findOne(userId);

    if (target.status !== 'ACTIVE') {
      throw new ConflictException(
        'Only an active account can have its role changed — use approve for a pending one',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: ADMIN_FACING_SELECT,
    });
  }

  async updateStatus(
    adminId: string,
    userId: string,
    status: 'ACTIVE' | 'DEACTIVATED',
  ) {
    const target = await this.findOne(userId);

    if (target.status !== 'ACTIVE' && target.status !== 'DEACTIVATED') {
      throw new ConflictException(
        'Account has not been approved yet — use approve/reject instead',
      );
    }

    if (userId === adminId && status === 'DEACTIVATED') {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: ADMIN_FACING_SELECT,
    });
  }

  private async getPendingOrThrow(userId: string) {
    const target = await this.findOne(userId);

    if (target.status !== 'PENDING_APPROVAL') {
      throw new ConflictException('This account is not awaiting approval');
    }

    return target;
  }
}
