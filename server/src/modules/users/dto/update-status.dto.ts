import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Deliberately narrower than the full UserStatus enum — this endpoint
 * toggles an already-approved account between active and deactivated.
 * PENDING_APPROVAL and REJECTED are reached only through approve/reject.
 */
export class UpdateStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DEACTIVATED'] })
  @IsIn(['ACTIVE', 'DEACTIVATED'])
  status: 'ACTIVE' | 'DEACTIVATED';
}
