import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationType } from '@prisma/client';

export class NotificationPreferenceItem {
  @ApiProperty({
    description: 'Notification type',
    enum: NotificationType,
    example: NotificationType.NEW_ACTIVITY,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({
    description: 'Whether this notification type is enabled',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({
    description: 'Array of notification preferences to update',
    type: [NotificationPreferenceItem],
    example: [
      { type: NotificationType.NEW_ACTIVITY, enabled: true },
      { type: NotificationType.ACTIVITY_DUE_REMINDER, enabled: false },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItem)
  preferences!: NotificationPreferenceItem[];
}
