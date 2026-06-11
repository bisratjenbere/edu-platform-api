import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateBlockDto } from './create-block.dto';

// Type is not updatable — only content, order, and is_required
export class UpdateBlockDto extends PartialType(
  OmitType(CreateBlockDto, ['type'] as const),
) {}
