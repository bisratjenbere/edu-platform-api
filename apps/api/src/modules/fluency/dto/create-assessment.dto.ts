import {
  IsUUID,
  IsString,
  IsNotEmpty,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ─── Custom validator: @IsWordCountBetween(min, max) ────────────────────────
export function IsWordCountBetween(
  min: number,
  max: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWordCountBetween',
      target: (object as any).constructor,
      propertyName,
      constraints: [min, max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const wordCount = value
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0).length;
          const [minWords, maxWords] = args.constraints as [number, number];
          return wordCount >= minWords && wordCount <= maxWords;
        },
        defaultMessage(args: ValidationArguments) {
          const [minWords, maxWords] = args.constraints as [number, number];
          const value = args.value as string | undefined;
          if (typeof value === 'string') {
            const wordCount = value
              .trim()
              .split(/\s+/)
              .filter((w) => w.length > 0).length;
            if (wordCount < minWords) {
              return `Passage must be at least ${minWords} words`;
            }
            if (wordCount > maxWords) {
              return `Passage cannot exceed ${maxWords} words`;
            }
          }
          return `Passage must be between ${minWords} and ${maxWords} words`;
        },
      },
    });
  };
}

// ─── DTO ────────────────────────────────────────────────────────────────────
export class CreateAssessmentDto {
  @ApiProperty({
    description: 'Class ID the assessment belongs to',
    format: 'uuid',
  })
  @IsUUID()
  class_id: string;

  @ApiProperty({
    description: 'Student ID to assign the assessment to',
    format: 'uuid',
  })
  @IsUUID()
  student_id: string;

  @ApiProperty({
    description: 'Reading passage text (20–500 words)',
    example: 'The sun rose slowly over the quiet hills...',
    minLength: 20,
  })
  @IsString()
  @IsNotEmpty()
  @IsWordCountBetween(20, 500)
  passage_text: string;
}
