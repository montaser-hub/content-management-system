import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../../generated/prisma/client.js';
import { IsEnum } from 'class-validator';

export class ApproveUserDto {
  @ApiProperty({
    enum: Role,
    description:
      "The Admin's own choice — independent of the applicant's requestedRole (decision 8.2).",
  })
  @IsEnum(Role)
  role: Role;
}
