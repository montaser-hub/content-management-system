import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ApproveUserDto } from './dto/approve-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UsersService } from './users.service';

/**
 * Every route here maps 1:1 to the "Manage users and roles" row of
 * docs/permission-matrix.md — Admin only, everyone else gets the same 403
 * RolesGuard returns for any other role mismatch (docs/story-1 §6).
 */
@ApiTags('users')
// Matches the 'cookie' security scheme registered in main.ts
// (`.addCookieAuth('access_token')`) — this API only ever reads the
// access_token cookie, never an Authorization header, so this must stay
// ApiCookieAuth, not ApiBearerAuth.
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users, optionally filtered by ?status=' })
  findAll(@Query() query: FindUsersQueryDto) {
    return this.usersService.findAll(query.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({
    summary: 'Approve a pending registration and assign its role',
  })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveUserDto,
  ) {
    return this.usersService.approve(admin.id, id, dto.role);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a pending registration' })
  reject(@Param('id') id: string) {
    return this.usersService.reject(id);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: "Change an already-active user's role" })
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(id, dto.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate an already-approved user' })
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.usersService.updateStatus(admin.id, id, dto.status);
  }
}
