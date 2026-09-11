import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../../generated/prisma/client.js';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'new.contributor@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 10, example: 'a-strong-passphrase' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({
    enum: Role,
    description:
      'A non-binding hint — see docs/story-1-admin-creates-users.md §8.2. ' +
      'The Admin who reviews this request chooses the actual role.',
  })
  @IsOptional()
  @IsEnum(Role)
  requestedRole?: Role;
}
