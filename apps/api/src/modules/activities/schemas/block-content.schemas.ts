import { z } from 'zod';
import { BlockType } from '@prisma/client';

// Instruction / content blocks (no student response)

export const TextBlockSchema = z.object({
  html: z.string().max(50000, 'HTML content cannot exceed 50,000 characters'),
});

export const VoiceInstructionBlockSchema = z.object({
  audio: z.object({
    url: z.string().url(),
    mimeType: z.string(),
    durationSeconds: z.number().optional(),
  }),
  transcriptText: z.string().optional(),
});

export const VideoInstructionBlockSchema = z.object({
  video: z.object({
    url: z.string().url(),
    mimeType: z.string(),
    durationSeconds: z.number().optional(),
  }),
  thumbnailUrl: z.string().url().optional(),
  captionsUrl: z.string().url().optional(),
});

export const ImageBlockSchema = z.object({
  image: z.object({
    url: z.string().url(),
    mimeType: z.string(),
  }),
  altText: z.string().max(500).optional(),
  caption: z.string().max(500).optional(),
});

export const PdfBlockSchema = z.object({
  pdf: z.object({
    url: z.string().url(),
    mimeType: z.string(),
  }),
  displayName: z.string().max(200),
});

export const LinkBlockSchema = z.object({
  url: z.string().url(),
  displayText: z.string().max(200),
  embedType: z
    .enum(['youtube', 'vimeo', 'googledocs', 'external'])
    .optional(),
});

// Response blocks (student submits content into these)

export const DrawingCanvasBlockSchema = z.object({
  backgroundImageUrl: z.string().url().optional(),
  backgroundAltText: z.string().max(500).optional(),
  canvasWidthPx: z.number().default(800),
  canvasHeightPx: z.number().default(600),
});

export const MultipleChoiceBlockSchema = z.object({
  question: z.string().max(1000),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(500),
      }),
    )
    .min(2)
    .max(6),
  correctOptionId: z.string(),
  allowMultipleCorrect: z.boolean().default(false),
});

export const TrueFalseBlockSchema = z.object({
  question: z.string().max(1000),
  correctAnswer: z.boolean(),
});

export const PollBlockSchema = z.object({
  question: z.string().max(1000),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(500),
      }),
    )
    .min(2)
    .max(10),
});

export const DragDropBlockSchema = z.object({
  instruction: z.string().max(1000),
  items: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(200),
        imageUrl: z.string().url().optional(),
      }),
    )
    .min(2)
    .max(20),
  targets: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(200),
      }),
    )
    .min(2)
    .max(20),
  correctMapping: z.record(z.string(), z.string()),
});

export const ShortAnswerBlockSchema = z.object({
  prompt: z.string().max(1000),
  maxCharacters: z.number().max(2000).default(500),
  placeholder: z.string().max(200).optional(),
});

export const OpenEndedBlockSchema = z.object({
  prompt: z.string().max(1000),
  allowedResponseTypes: z
    .array(z.enum(['drawing', 'audio', 'video', 'photo', 'text']))
    .min(1),
  maxVideoDurationSeconds: z.number().default(300),
  maxAudioDurationSeconds: z.number().default(300),
});

// Map of BlockType to Zod schema
export const BLOCK_CONTENT_SCHEMAS: Record<BlockType, z.ZodTypeAny> = {
  [BlockType.TEXT]: TextBlockSchema,
  [BlockType.VOICE_INSTRUCTION]: VoiceInstructionBlockSchema,
  [BlockType.VIDEO_INSTRUCTION]: VideoInstructionBlockSchema,
  [BlockType.IMAGE]: ImageBlockSchema,
  [BlockType.PDF]: PdfBlockSchema,
  [BlockType.LINK]: LinkBlockSchema,
  [BlockType.DRAWING_CANVAS]: DrawingCanvasBlockSchema,
  [BlockType.MULTIPLE_CHOICE]: MultipleChoiceBlockSchema,
  [BlockType.TRUE_FALSE]: TrueFalseBlockSchema,
  [BlockType.POLL]: PollBlockSchema,
  [BlockType.DRAG_DROP]: DragDropBlockSchema,
  [BlockType.SHORT_ANSWER]: ShortAnswerBlockSchema,
  [BlockType.OPEN_ENDED]: OpenEndedBlockSchema,
};
