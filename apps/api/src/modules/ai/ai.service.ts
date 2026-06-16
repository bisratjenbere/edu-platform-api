import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerateActivityDto,
  SaveGeneratedDto,
  DraftFeedbackDto,
  DraftFeedbackResponseDto,
  MisconceptionReportDto,
  MisconceptionReportResponseDto,
  AdaptiveActivityDto,
  DraftFamilyMessageDto,
  DraftFamilyMessageResponseDto,
  FluencyPassageDto,
  FluencyPassageResponseDto,
  RubricGeneratorDto,
  RubricResponseDto,
  StandardsAlignmentDto,
  StandardsAlignmentResponseDto,
  DifferentiationDto,
  DifferentiationResponseDto,
  JournalCommentSuggestionDto,
  JournalCommentSuggestionResponseDto,
  TemplateQualityDto,
  TemplateQualityResponseDto,
} from './dto';
import { z } from 'zod';
import { BlockType, ActivityStatus, GradeLevel } from '@prisma/client';
import { BLOCK_CONTENT_SCHEMAS } from '../activities/schemas/block-content.schemas';
import axios, { AxiosError } from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas for AI response validation
// ─────────────────────────────────────────────────────────────────────────────

const AiActivitySchema = z.object({
  suggestedTitle: z.string().max(200),
  suggestedDescription: z.string().max(1000).optional(),
  blocks: z
    .array(
      z.object({
        type: z.nativeEnum(BlockType),
        content: z.record(z.string(), z.unknown()),
        order: z.number().int(),
      }),
    )
    .min(1)
    .max(20),
});

const FeedbackSchema = z.object({
  draftFeedback: z.string().max(2000),
  strengthsSummary: z.string().max(500),
  growthAreas: z.array(z.string().max(200)).max(5),
});

const MisconceptionSchema = z.object({
  overallAccuracyPercent: z.number().min(0).max(100),
  submissionsAnalyzed: z.number().int(),
  misconceptions: z.array(
    z.object({
      blockOrder: z.number().int(),
      questionText: z.string(),
      accuracyPercent: z.number().min(0).max(100),
      misconceptionDescription: z.string(),
      commonErrors: z.array(z.object({ answer: z.string(), count: z.number() })),
      teachingSuggestion: z.string(),
    }),
  ),
  summary: z.string().max(1000),
  followUpRecommended: z.boolean(),
});

const FamilyMessageSchema = z.object({
  draftMessage: z.string().max(2000),
  suggestedSubject: z.string().max(200),
  highlightsUsed: z.array(z.string().max(200)).max(10),
});

const FluencyPassageSchema = z.object({
  passageText: z.string().max(3000),
  wordCount: z.number().int(),
  estimatedLexileRange: z.string().max(50),
  keyVocabulary: z.array(z.string().max(50)).max(10),
});

const RubricSchema = z.object({
  levels: z.array(
    z.object({
      level: z.string().max(100),
      points: z.number().int(),
      description: z.string().max(500),
      exampleResponse: z.string().max(500),
    }),
  ).min(3).max(4),
  focusCriteria: z.array(z.string().max(200)).max(5),
  studentFacingDescription: z.string().max(500),
});

const StandardsSchema = z.object({
  suggestedStandards: z.array(
    z.object({
      standardCode: z.string().max(50),
      standardDescription: z.string().max(500),
      alignmentStrength: z.enum(['high', 'medium', 'low']),
      evidenceFromBlocks: z.array(z.string().max(200)),
    }),
  ).max(10),
  inferredSubject: z.string().max(100),
  inferredGradeLevel: z.string().max(50),
  standardCodes: z.array(z.string().max(50)).max(10),
});

const DifferentiationSchema = z.object({
  customInstructions: z.string().max(1000),
  blockAccommodations: z.array(
    z.object({
      blockOrder: z.number().int(),
      blockType: z.string(),
      accommodation: z.string().max(300),
    }),
  ).max(20),
  strengthsLeveraged: z.array(z.string().max(200)).max(5),
  supportAreas: z.array(z.string().max(200)).max(5),
});

const JournalCommentSchema = z.object({
  suggestedComment: z.string().max(500),
  shortAlternative: z.string().max(150),
});

const TemplateQualitySchema = z.object({
  overallScore: z.number().min(1).max(5),
  clarityScore: z.number().min(1).max(5),
  ageAppropriatenessScore: z.number().min(1).max(5),
  blockVarietyScore: z.number().min(1).max(5),
  standardsAlignmentScore: z.number().min(1).max(5),
  improvementSuggestions: z.array(z.string().max(300)).max(5),
  recommendedForLibrary: z.boolean(),
  qualitySummary: z.string().max(500),
});

type AiActivityResponse = z.infer<typeof AiActivitySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const AI_GENERATABLE_BLOCK_TYPES = new Set<BlockType>([
  BlockType.TEXT,
  BlockType.MULTIPLE_CHOICE,
  BlockType.TRUE_FALSE,
  BlockType.POLL,
  BlockType.DRAG_DROP,
  BlockType.SHORT_ANSWER,
  BlockType.OPEN_ENDED,
  BlockType.DRAWING_CANVAS,
]);

const GRADE_LABEL: Record<string, string> = {
  PREK: 'Pre-K (ages 4–5)',
  K: 'Kindergarten (age 5–6)',
  G1: '1st Grade (age 6–7)',
  G2: '2nd Grade (age 7–8)',
  G3: '3rd Grade (age 8–9)',
  G4: '4th Grade (age 9–10)',
  G5: '5th Grade (age 10–11)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeTopic(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/```/g, '')
    .trim()
    .slice(0, 500);
}

function gradeLabel(level: string | null | undefined): string {
  if (!level) return 'not specified — use language appropriate for ages 7–9';
  return GRADE_LABEL[level] ?? level;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly MODEL: string;
  private readonly DAILY_LIMIT: number;
  private readonly APP_URL: string;
  private readonly TIMEOUT_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.MODEL =
      this.config.get<string>('AI_MODEL') ??
      'meta-llama/llama-3.3-70b-instruct:free';
    this.DAILY_LIMIT = parseInt(
      this.config.get<string>('AI_DAILY_LIMIT') ?? '20',
      10,
    );
    this.APP_URL = this.config.get<string>('APP_URL') ?? 'https://eduflow.app';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 1: Generate Activity
  // ───────────────────────────────────────────────────────────────────────────

  async generateActivity(
    teacherId: string,
    dto: GenerateActivityDto,
  ): Promise<AiActivityResponse> {
    await this.assertDailyLimitNotReached(teacherId);

    const safeDto: GenerateActivityDto = {
      ...dto,
      topic: sanitizeTopic(dto.topic),
      blockTypes: dto.blockTypes?.filter((t) =>
        AI_GENERATABLE_BLOCK_TYPES.has(t),
      ),
    };

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<AiActivityResponse>(
        () => this.buildActivityMessages(safeDto, false),
        () => this.buildActivityMessages(safeDto, true),
        (text) => this.parseWith(AiActivitySchema, text),
        'activity-generator',
      );

    await this.validateActivityBlocks(parsed);
    await this.logUsage(teacherId, 'activity-generator', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 1b: Save Generated Activity
  // ───────────────────────────────────────────────────────────────────────────

  async saveGenerated(teacherId: string, dto: SaveGeneratedDto) {
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: { class_id: dto.classId, teacher_id: teacherId, deleted_at: null },
    });
    if (!classTeacher) {
      throw new BadRequestException('Class not found or access denied');
    }

    for (const block of dto.blocks) {
      if (!AI_GENERATABLE_BLOCK_TYPES.has(block.type)) {
        throw new BadRequestException(
          `Block type ${block.type} cannot be created via AI generation`,
        );
      }
      const schema = BLOCK_CONTENT_SCHEMAS[block.type];
      if (!schema) throw new BadRequestException(`Invalid block type: ${block.type}`);
      const validation = schema.safeParse(block.content);
      if (!validation.success) {
        throw new BadRequestException(
          `Invalid content for block type ${block.type}: ${validation.error.message}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const newActivity = await tx.activity.create({
        data: {
          title: dto.title,
          description: dto.description,
          class_id: dto.classId,
          created_by: teacherId,
          status: ActivityStatus.DRAFT,
          is_from_library: false,
          standards_tags: dto.standardsTags ?? [],
          subject_tag: dto.subject ?? null,
          grade_level_tag: dto.gradeLevel ?? null,
        },
      });

      await tx.activityBlock.createMany({
        data: dto.blocks.map((block) => ({
          activity_id: newActivity.id,
          type: block.type,
          content: block.content as any,
          order: block.order,
          is_required: block.isRequired ?? true,
        })),
      });

      return tx.activity.findUnique({
        where: { id: newActivity.id },
        include: { blocks: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 2: Draft Submission Feedback
  // ───────────────────────────────────────────────────────────────────────────

  async draftFeedback(
    teacherId: string,
    dto: DraftFeedbackDto,
  ): Promise<DraftFeedbackResponseDto> {
    // Fetch submission with all block responses and the parent activity
    const submission = await this.prisma.submission.findFirst({
      where: { id: dto.submissionId, deleted_at: null },
      include: {
        activity: {
          include: { blocks: { orderBy: { order: 'asc' } } },
        },
        student: { select: { first_name: true, grade_level: true } },
        blocks: true,
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    // Verify teacher owns the class this submission belongs to
    await this.assertTeacherOwnsClass(teacherId, submission.class_id);

    // Build a readable summary of the student's responses
    const blockSummaries = submission.activity.blocks.map((actBlock) => {
      const subBlock = submission.blocks.find((sb) => sb.block_id === actBlock.id);
      return {
        order: actBlock.order,
        type: actBlock.type,
        prompt: this.extractPromptText(actBlock.content as Record<string, unknown>),
        studentResponse: subBlock
          ? this.extractResponseText(actBlock.type, subBlock.response_content as Record<string, unknown>)
          : '(no response)',
        autoScore: subBlock?.auto_score ?? null,
      };
    });

    await this.assertDailyLimitNotReached(teacherId);

    const systemPrompt = `You are an experienced elementary school teacher writing personalized, encouraging feedback for a student's submitted activity.
Your feedback should:
- Be warm, specific, and growth-oriented
- Reference what the student actually did — never be generic
- Be appropriate for the grade level
- Be written as if speaking directly to the student and their family
- Never reveal correct answers they got wrong — instead guide them to think again
Return ONLY valid JSON with no markdown fences.`;

    const studentName = submission.student.first_name || 'the student';
    const activityTitle = submission.activity.title;
    const grade = gradeLabel(submission.activity.grade_level_tag);
    const toneNote = dto.toneHint ? `Teacher's preferred tone: ${dto.toneHint}.` : '';

    const userPrompt = `Draft personalized feedback for ${studentName}'s submission on the activity "${activityTitle}" (${grade}).

${toneNote}

Student's block-by-block responses:
${blockSummaries
  .map(
    (b) =>
      `Block ${b.order} [${b.type}]\nPrompt: ${b.prompt}\nStudent response: ${b.studentResponse}${b.autoScore !== null ? `\nAuto-score: ${b.autoScore}` : ''}`,
  )
  .join('\n\n')}

Return JSON:
{
  "draftFeedback": "Warm, specific feedback paragraph (max 300 words) to be shown to student and family",
  "strengthsSummary": "1-2 sentences on what the student demonstrated well",
  "growthAreas": ["specific area to grow", "another area if applicable"]
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<DraftFeedbackResponseDto>(
        () => [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        () => [
          { role: 'system', content: systemPrompt + '\nIMPORTANT: Return ONLY raw JSON. No markdown. No preamble.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(FeedbackSchema, text),
        'feedback-drafter',
      );

    await this.logUsage(teacherId, 'feedback-drafter', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 3: Class Misconception Report
  // ───────────────────────────────────────────────────────────────────────────

  async getMisconceptionReport(
    teacherId: string,
    dto: MisconceptionReportDto,
  ): Promise<MisconceptionReportResponseDto> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: dto.activityId, deleted_at: null },
      include: { blocks: { orderBy: { order: 'asc' } } },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertTeacherOwnsClass(teacherId, activity.class_id);

    // Only analyze auto-gradeable blocks
    const gradeableBlocks = activity.blocks.filter((b) =>
      [BlockType.MULTIPLE_CHOICE, BlockType.TRUE_FALSE, BlockType.DRAG_DROP].includes(b.type),
    );
    if (gradeableBlocks.length === 0) {
      throw new BadRequestException(
        'This activity has no auto-gradeable blocks (MULTIPLE_CHOICE, TRUE_FALSE, DRAG_DROP) to analyze',
      );
    }

    // Fetch all submitted blocks for this activity
    const submissionBlocks = await this.prisma.submissionBlock.findMany({
      where: {
        submission: {
          activity_id: dto.activityId,
          status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED'] },
          deleted_at: null,
        },
        block_id: { in: gradeableBlocks.map((b) => b.id) },
      },
      include: { submission: { select: { student_id: true } } },
    });

    const submissionCount = new Set(
      submissionBlocks.map((sb) => sb.submission.student_id),
    ).size;

    if (submissionCount === 0) {
      throw new BadRequestException('No submitted responses found for this activity yet');
    }

    // Aggregate response data per block
    const blockData = gradeableBlocks.map((block) => {
      const blockResponses = submissionBlocks.filter((sb) => sb.block_id === block.id);
      const content = block.content as Record<string, unknown>;
      return {
        order: block.order,
        type: block.type,
        prompt: this.extractPromptText(content),
        correctAnswer: this.extractCorrectAnswer(block.type, content),
        responses: blockResponses.map((r) => ({
          response: this.extractResponseText(block.type, r.response_content as Record<string, unknown>),
          autoScore: r.auto_score,
        })),
        accuracyPercent:
          blockResponses.length > 0
            ? Math.round(
                (blockResponses.filter((r) => (r.auto_score ?? 0) >= 1).length /
                  blockResponses.length) *
                  100,
              )
            : 0,
      };
    });

    await this.assertDailyLimitNotReached(teacherId);

    const systemPrompt = `You are an expert elementary school instructional coach analyzing student response data to identify learning gaps.
Your analysis should be specific, actionable, and written in plain English a classroom teacher can immediately use.
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Analyze this class submission data for the activity "${activity.title}" (${gradeLabel(activity.grade_level_tag)}).

Total students who submitted: ${submissionCount}

Per-block data:
${blockData
  .map(
    (b) =>
      `Block ${b.order} [${b.type}]
Prompt: ${b.prompt}
Correct answer: ${b.correctAnswer}
Accuracy: ${b.accuracyPercent}% (${b.responses.filter((r) => (r.autoScore ?? 0) >= 1).length}/${b.responses.length} correct)
All student responses: ${JSON.stringify(b.responses.map((r) => r.response))}`,
  )
  .join('\n\n')}

Return JSON:
{
  "overallAccuracyPercent": <number 0-100>,
  "submissionsAnalyzed": ${submissionCount},
  "misconceptions": [
    {
      "blockOrder": <number>,
      "questionText": "<the prompt>",
      "accuracyPercent": <number>,
      "misconceptionDescription": "<plain-English description of what the pattern of wrong answers reveals about student thinking>",
      "commonErrors": [{ "answer": "<wrong answer text>", "count": <number> }],
      "teachingSuggestion": "<specific instructional move to address this>"
    }
  ],
  "summary": "<2-3 sentence executive summary for the teacher>",
  "followUpRecommended": <true if overall accuracy < 70%>
}
Only include blocks with accuracy below 80% in misconceptions.`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<MisconceptionReportResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(MisconceptionSchema, text),
        'misconception-report',
      );

    await this.logUsage(teacherId, 'misconception-report', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 4: Adaptive Follow-Up Activity Generation
  // ───────────────────────────────────────────────────────────────────────────

  async generateAdaptiveActivity(
    teacherId: string,
    dto: AdaptiveActivityDto,
  ): Promise<AiActivityResponse> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: dto.activityId, deleted_at: null },
      include: { blocks: { orderBy: { order: 'asc' } } },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertTeacherOwnsClass(teacherId, activity.class_id);

    // Get the misconception report data inline (reuse logic without going through AI again)
    const gradeableBlocks = activity.blocks.filter((b) =>
      [BlockType.MULTIPLE_CHOICE, BlockType.TRUE_FALSE, BlockType.DRAG_DROP].includes(b.type),
    );

    let gapSummary = 'No prior submission data available — generate a solid foundational follow-up.';

    if (gradeableBlocks.length > 0) {
      const submissionBlocks = await this.prisma.submissionBlock.findMany({
        where: {
          submission: {
            activity_id: dto.activityId,
            status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED'] },
            deleted_at: null,
          },
          block_id: { in: gradeableBlocks.map((b) => b.id) },
        },
      });

      if (submissionBlocks.length > 0) {
        const weakBlocks = gradeableBlocks
          .map((block) => {
            const responses = submissionBlocks.filter((sb) => sb.block_id === block.id);
            const accuracy =
              responses.length > 0
                ? (responses.filter((r) => (r.auto_score ?? 0) >= 1).length / responses.length) * 100
                : 100;
            return { block, accuracy };
          })
          .filter((b) => b.accuracy < 80)
          .sort((a, b) => a.accuracy - b.accuracy);

        if (weakBlocks.length > 0) {
          gapSummary = weakBlocks
            .map(
              ({ block, accuracy }) =>
                `- "${this.extractPromptText(block.content as Record<string, unknown>)}" — only ${Math.round(accuracy)}% of students answered correctly`,
            )
            .join('\n');
        }
      }
    }

    await this.assertDailyLimitNotReached(teacherId);

    const originalTopic = `${activity.title}${activity.description ? ': ' + activity.description : ''}`;
    const grade = gradeLabel(activity.grade_level_tag);
    const standards = activity.standards_tags.length > 0
      ? `Standards: ${activity.standards_tags.join(', ')}`
      : '';
    const teacherNote = dto.teacherNote ? `Teacher note: ${dto.teacherNote}` : '';

    const systemPrompt = `You are an expert elementary curriculum designer creating targeted remediation and extension activities.
Your activity should directly address identified learning gaps from prior assessment data.
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Generate a follow-up activity that addresses learning gaps from the original activity: "${originalTopic}"
Grade level: ${grade}
${standards}
${teacherNote}

Identified learning gaps from class submission data:
${gapSummary}

Design the follow-up to:
1. Re-approach the concepts students struggled with using different representations
2. Build on what students already demonstrated understanding of
3. Use at least 3 varied block types
4. Be engaging and not feel like a repeat of the same activity

${this.blockSchemasPrompt()}

${this.outputSchemaPrompt()}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<AiActivityResponse>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(AiActivitySchema, text),
        'adaptive-generator',
      );

    await this.validateActivityBlocks(parsed);
    await this.logUsage(teacherId, 'adaptive-generator', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 5: Draft Family Progress Message
  // ───────────────────────────────────────────────────────────────────────────

  async draftFamilyMessage(
    teacherId: string,
    dto: DraftFamilyMessageDto,
  ): Promise<DraftFamilyMessageResponseDto> {
    await this.assertTeacherOwnsClass(teacherId, dto.classId);

    // Verify student is in this class
    const classStudent = await this.prisma.classStudent.findFirst({
      where: { class_id: dto.classId, student_id: dto.studentId, deleted_at: null },
      include: { student: { select: { first_name: true, last_name: true } } },
    });
    if (!classStudent) throw new NotFoundException('Student not found in this class');

    // Fetch recent journal posts (last 14 days, approved)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const recentJournalPosts = await this.prisma.journalPost.findMany({
      where: {
        student_id: dto.studentId,
        class_id: dto.classId,
        status: 'APPROVED',
        deleted_at: null,
        created_at: { gte: twoWeeksAgo },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { content_text: true, created_at: true, type: true },
    });

    // Fetch recent submissions with teacher feedback
    const recentSubmissions = await this.prisma.submission.findMany({
      where: {
        student_id: dto.studentId,
        class_id: dto.classId,
        status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED'] },
        deleted_at: null,
        submitted_at: { gte: twoWeeksAgo },
      },
      orderBy: { submitted_at: 'desc' },
      take: 5,
      select: {
        activity: { select: { title: true } },
        score: true,
        max_score: true,
        teacher_feedback_text: true,
        submitted_at: true,
      },
    });

    await this.assertDailyLimitNotReached(teacherId);

    const studentName = classStudent.student.first_name;
    const focusNote = dto.focusArea ? `Focus area: ${dto.focusArea}` : '';

    const systemPrompt = `You are a caring elementary school teacher writing a personalized progress update to a student's family.
The message should:
- Be warm, conversational, and specific — reference real things the student did
- Be positive and forward-looking
- Never disclose other students' information
- Be written in plain language a family member can understand
- Feel personal, not like a template
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Draft a progress update message to ${studentName}'s family.
${focusNote}

Recent activity data:
${recentSubmissions.length > 0
  ? recentSubmissions
      .map(
        (s) =>
          `- Activity: "${s.activity.title}"${s.score !== null && s.max_score !== null ? ` (scored ${s.score}/${s.max_score})` : ''}${s.teacher_feedback_text ? `\n  Teacher note: ${s.teacher_feedback_text}` : ''}`,
      )
      .join('\n')
  : '(no recent submissions)'}

Recent journal posts:
${recentJournalPosts.length > 0
  ? recentJournalPosts
      .map((p) => `- ${p.type}: ${p.content_text?.slice(0, 100) ?? '(media post)'}`)
      .join('\n')
  : '(no recent journal posts)'}

Return JSON:
{
  "draftMessage": "<warm, specific 2-4 paragraph message to the family>",
  "suggestedSubject": "<email subject line, e.g. '${studentName} has been working hard this week!'>",
  "highlightsUsed": ["<specific highlight from the data>", ...]
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<DraftFamilyMessageResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(FamilyMessageSchema, text),
        'family-message-drafter',
      );

    await this.logUsage(teacherId, 'family-message-drafter', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 6: Fluency Passage Generator
  // ───────────────────────────────────────────────────────────────────────────

  async generateFluencyPassage(
    teacherId: string,
    dto: FluencyPassageDto,
  ): Promise<FluencyPassageResponseDto> {
    await this.assertDailyLimitNotReached(teacherId);

    const targetWords = dto.targetWordCount ?? 100;
    const grade = gradeLabel(dto.gradeLevel);
    const topicNote = dto.topic ? `Topic: ${dto.topic}` : 'Choose an age-appropriate, engaging topic.';

    const systemPrompt = `You are a literacy specialist creating oral reading fluency passages for elementary students.
Passages must:
- Use sentence lengths and vocabulary calibrated precisely to the grade level
- Flow naturally when read aloud (vary sentence length, avoid tongue-twisters)
- Tell a coherent short narrative or informational piece — not a list
- Avoid proper nouns that students may not recognize (brand names, obscure place names)
- Never include dialogue that is confusing to read aloud
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Create an oral reading fluency passage for ${grade}.
${topicNote}
Target word count: approximately ${targetWords} words (range: ${targetWords - 10} to ${targetWords + 10}).

Calibration guidance for ${grade}:
${this.fluencyCalibrationGuide(dto.gradeLevel)}

Return JSON:
{
  "passageText": "<the complete reading passage as plain text, no HTML>",
  "wordCount": <integer actual word count>,
  "estimatedLexileRange": "<e.g. '420L–520L'>",
  "keyVocabulary": ["<word that may need pre-teaching>", ...]
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<FluencyPassageResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(FluencyPassageSchema, text),
        'fluency-passage-generator',
      );

    await this.logUsage(teacherId, 'fluency-passage-generator', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 7: Rubric Generator
  // ───────────────────────────────────────────────────────────────────────────

  async generateRubric(
    teacherId: string,
    dto: RubricGeneratorDto,
  ): Promise<RubricResponseDto> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: dto.activityId, deleted_at: null },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertTeacherOwnsClass(teacherId, activity.class_id);

    await this.assertDailyLimitNotReached(teacherId);

    const grade = gradeLabel(activity.grade_level_tag);

    const systemPrompt = `You are an experienced elementary school teacher and curriculum designer creating clear, specific grading rubrics.
Rubrics must:
- Use concrete, observable language (not vague phrases like "shows understanding")
- Be calibrated to the grade level's developmental expectations
- Include realistic example student responses at each level
- Have a student-facing version in simple language
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Create a grading rubric for the following ${dto.blockType} block in an activity for ${grade}.

Prompt the student will see:
"${dto.promptText}"

Return JSON with 3 levels (Exceeds Expectations, Meets Expectations, Approaching Expectations):
{
  "levels": [
    {
      "level": "Exceeds Expectations",
      "points": 3,
      "description": "<observable description of what a student does to exceed>",
      "exampleResponse": "<realistic example of a student response at this level>"
    },
    {
      "level": "Meets Expectations",
      "points": 2,
      "description": "<observable description>",
      "exampleResponse": "<realistic example>"
    },
    {
      "level": "Approaching Expectations",
      "points": 1,
      "description": "<observable description>",
      "exampleResponse": "<realistic example>"
    }
  ],
  "focusCriteria": ["<key criterion 1>", "<key criterion 2>"],
  "studentFacingDescription": "<simple, friendly explanation of what a great response looks like, written for the student>"
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<RubricResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(RubricSchema, text),
        'rubric-generator',
      );

    await this.logUsage(teacherId, 'rubric-generator', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 8: Standards Alignment Checker
  // ───────────────────────────────────────────────────────────────────────────

  async checkStandardsAlignment(
    teacherId: string,
    dto: StandardsAlignmentDto,
  ): Promise<StandardsAlignmentResponseDto> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: dto.activityId, deleted_at: null },
      include: { blocks: { orderBy: { order: 'asc' } } },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertTeacherOwnsClass(teacherId, activity.class_id);

    await this.assertDailyLimitNotReached(teacherId);

    const blockDescriptions = activity.blocks
      .map(
        (b) =>
          `Block ${b.order} [${b.type}]: ${this.extractPromptText(b.content as Record<string, unknown>)}`,
      )
      .join('\n');

    const systemPrompt = `You are a curriculum alignment specialist who knows Common Core State Standards, NGSS, and state-level K-5 standards deeply.
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Analyze this activity for standards alignment.

Activity title: "${activity.title}"
Description: "${activity.description ?? 'none'}"
Grade level: ${gradeLabel(activity.grade_level_tag)}
Subject tag: ${activity.subject_tag ?? 'not specified'}
Existing standards tags: ${activity.standards_tags.join(', ') || 'none'}

Block content:
${blockDescriptions}

Identify which academic standards this activity aligns to. Focus on the 2-5 most relevant standards.
For each, specify the alignment strength (high = directly assessed, medium = practiced, low = incidentally touched).

Return JSON:
{
  "suggestedStandards": [
    {
      "standardCode": "<e.g. CCSS.ELA-LITERACY.RI.3.1 or NGSS.3-LS1-1>",
      "standardDescription": "<full standard description>",
      "alignmentStrength": "high" | "medium" | "low",
      "evidenceFromBlocks": ["<which block content provides evidence>"]
    }
  ],
  "inferredSubject": "<subject area>",
  "inferredGradeLevel": "<grade level>",
  "standardCodes": ["<code1>", "<code2>"]
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<StandardsAlignmentResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(StandardsSchema, text),
        'standards-alignment',
      );

    await this.logUsage(teacherId, 'standards-alignment', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 9: Smart Differentiation
  // ───────────────────────────────────────────────────────────────────────────

  async generateDifferentiation(
    teacherId: string,
    dto: DifferentiationDto,
  ): Promise<DifferentiationResponseDto> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: dto.activityId, deleted_at: null },
      include: { blocks: { orderBy: { order: 'asc' } } },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertTeacherOwnsClass(teacherId, activity.class_id);

    const classStudent = await this.prisma.classStudent.findFirst({
      where: { class_id: activity.class_id, student_id: dto.studentId, deleted_at: null },
      include: { student: { select: { first_name: true } } },
    });
    if (!classStudent) throw new NotFoundException('Student not found in this class');

    // Fetch student's recent submission history for context
    const recentSubmissions = await this.prisma.submission.findMany({
      where: {
        student_id: dto.studentId,
        class_id: activity.class_id,
        status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED'] },
        deleted_at: null,
      },
      orderBy: { submitted_at: 'desc' },
      take: 5,
      select: {
        activity: { select: { title: true } },
        score: true,
        max_score: true,
        teacher_feedback_text: true,
        blocks: { select: { auto_score: true, block_id: true } },
      },
    });

    await this.assertDailyLimitNotReached(teacherId);

    const studentName = classStudent.student.first_name;
    const grade = gradeLabel(activity.grade_level_tag);

    const historyNote =
      recentSubmissions.length > 0
        ? recentSubmissions
            .map(
              (s) =>
                `- "${s.activity.title}"${s.score !== null && s.max_score !== null ? ` (${s.score}/${s.max_score})` : ''}${s.teacher_feedback_text ? ` — teacher noted: "${s.teacher_feedback_text}"` : ''}`,
            )
            .join('\n')
        : '(no prior submission history available)';

    const teacherNote = dto.teacherNote
      ? `Teacher's observation: "${dto.teacherNote}"`
      : '';

    const blockList = activity.blocks
      .map((b) => `Block ${b.order} [${b.type}]: ${this.extractPromptText(b.content as Record<string, unknown>)}`)
      .join('\n');

    const systemPrompt = `You are an experienced special education and differentiation specialist.
Generate specific, practical accommodations for a student based on their learning profile.
Accommodations should maintain the learning objective while removing barriers to access.
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Generate differentiation instructions for ${studentName} for the activity "${activity.title}" (${grade}).

${teacherNote}

Student's recent submission history:
${historyNote}

Activity blocks:
${blockList}

Return JSON:
{
  "customInstructions": "<overall accommodation instructions for this student, max 200 words>",
  "blockAccommodations": [
    {
      "blockOrder": <number>,
      "blockType": "<type>",
      "accommodation": "<specific accommodation for this block>"
    }
  ],
  "strengthsLeveraged": ["<strength this differentiation builds on>"],
  "supportAreas": ["<area being supported by the accommodation>"]
}
Only include blocks that actually need accommodation — not every block needs one.`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<DifferentiationResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(DifferentiationSchema, text),
        'differentiation',
      );

    await this.logUsage(teacherId, 'differentiation', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 10: Journal Comment Suggestion
  // ───────────────────────────────────────────────────────────────────────────

  async suggestJournalComment(
    teacherId: string,
    dto: JournalCommentSuggestionDto,
  ): Promise<JournalCommentSuggestionResponseDto> {
    const post = await this.prisma.journalPost.findFirst({
      where: { id: dto.journalPostId, deleted_at: null },
      include: {
        student: { select: { first_name: true } },
        submission: {
          include: {
            activity: { select: { title: true, grade_level_tag: true } },
          },
        },
      },
    });
    if (!post) throw new NotFoundException('Journal post not found');
    await this.assertTeacherOwnsClass(teacherId, post.class_id);

    await this.assertDailyLimitNotReached(teacherId);

    const studentName = post.student.first_name;
    const activityTitle = post.submission?.activity.title ?? null;
    const grade = gradeLabel(post.submission?.activity.grade_level_tag ?? null);
    const contentText = post.content_text ?? '(media post — no text content)';
    const mediaNote =
      post.media_urls.length > 0
        ? `The post includes ${post.media_urls.length} media item(s).`
        : '';

    const systemPrompt = `You are a warm, encouraging elementary school teacher writing a comment on a student's portfolio post.
Comments should:
- Be specific to what the student actually shared
- Feel genuine and personal — not generic ("Great job!")
- Be age-appropriate and encouraging
- Be short enough that a student will actually read it
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Suggest a comment for ${studentName}'s journal post.
${activityTitle ? `From activity: "${activityTitle}" (${grade})` : ''}
${mediaNote}
Post content: "${contentText.slice(0, 500)}"

Return JSON:
{
  "suggestedComment": "<warm, specific comment, 1-3 sentences>",
  "shortAlternative": "<shorter version, 1 sentence, for quick approval>"
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<JournalCommentSuggestionResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(JournalCommentSchema, text),
        'journal-comment',
      );

    await this.logUsage(teacherId, 'journal-comment', promptTokens, completionTokens);
    return parsed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FEATURE 11: Template Quality Scorer
  // ───────────────────────────────────────────────────────────────────────────

  async scoreTemplateQuality(
    teacherId: string,
    dto: TemplateQualityDto,
  ): Promise<TemplateQualityResponseDto> {
    const template = await this.prisma.activityTemplate.findFirst({
      where: { id: dto.templateId, deleted_at: null },
    });
    if (!template) throw new NotFoundException('Template not found');

    // Only the template creator or an admin can score it
    if (template.created_by !== teacherId) {
      throw new ForbiddenException('Only the template creator can request a quality score');
    }

    await this.assertDailyLimitNotReached(teacherId);

    const blocksSnapshot = template.blocks_snapshot as Array<{
      type: string;
      content: Record<string, unknown>;
      order: number;
    }>;

    const blockDescriptions = blocksSnapshot
      .map(
        (b) =>
          `Block ${b.order} [${b.type}]: ${this.extractPromptText(b.content)}`,
      )
      .join('\n');

    const systemPrompt = `You are an experienced curriculum quality reviewer for an educational content library.
Score activities honestly — do not inflate scores. A score of 3/5 is good.
Return ONLY valid JSON with no markdown fences.`;

    const userPrompt = `Score this activity template for library quality.

Title: "${template.title}"
Description: "${template.description ?? 'none'}"
Grade level: ${template.grade_level ?? 'not specified'}
Subject: ${template.subject ?? 'not specified'}
Standards tags: ${template.standards_tags.join(', ') || 'none'}

Blocks:
${blockDescriptions}

Score each dimension 1–5:
- Clarity (1=confusing instructions, 5=crystal clear)
- Age-appropriateness (1=wrong level, 5=perfectly calibrated)
- Block variety (1=all same type, 5=excellent mix)
- Standards alignment (1=no alignment, 5=clearly aligned and tagged)

Return JSON:
{
  "overallScore": <average of the 4 scores, rounded to 1 decimal>,
  "clarityScore": <1-5>,
  "ageAppropriatenessScore": <1-5>,
  "blockVarietyScore": <1-5>,
  "standardsAlignmentScore": <1-5>,
  "improvementSuggestions": ["<specific suggestion>"],
  "recommendedForLibrary": <true if overallScore >= 3.5>,
  "qualitySummary": "<2-3 sentence honest qualitative summary>"
}`;

    const { parsed, promptTokens, completionTokens } =
      await this.callWithRetry<TemplateQualityResponseDto>(
        () => [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        () => [
          { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON.' },
          { role: 'user', content: userPrompt },
        ],
        (text) => this.parseWith(TemplateQualitySchema, text),
        'template-quality',
      );

    await this.logUsage(teacherId, 'template-quality', promptTokens, completionTokens);
    return parsed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: OpenRouter call
  // ─────────────────────────────────────────────────────────────────────────

  private async callOpenRouter(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.error('OPENROUTER_API_KEY is not configured');
      throw new InternalServerErrorException('AI service is not configured — contact support');
    }

    const response = await axios.post(
      this.OPENROUTER_URL,
      { model: this.MODEL, messages, max_tokens: 4096 },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': this.APP_URL,
          'X-Title': 'EduFlow',
          'Content-Type': 'application/json',
        },
        timeout: this.TIMEOUT_MS,
      },
    );

    return {
      text: response.data.choices[0]?.message?.content ?? '',
      promptTokens: response.data.usage?.prompt_tokens ?? 0,
      completionTokens: response.data.usage?.completion_tokens ?? 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Generic call-with-retry wrapper
  // ─────────────────────────────────────────────────────────────────────────

  private async callWithRetry<T>(
    buildMessages: () => Array<{ role: string; content: string }>,
    buildStrictMessages: () => Array<{ role: string; content: string }>,
    parse: (text: string) => T,
    feature: string,
  ): Promise<{ parsed: T; promptTokens: number; completionTokens: number }> {
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const response = await this.callOpenRouter(buildMessages());
      promptTokens += response.promptTokens;
      completionTokens += response.completionTokens;
      return { parsed: parse(response.text), promptTokens, completionTokens };
    } catch (firstError) {
      if (axios.isAxiosError(firstError)) {
        throw this.wrapApiError(firstError, `${feature} initial call`);
      }

      // Parse failure — retry with strict prompt
      this.logger.warn({ feature }, 'First parse failed — retrying with strict prompt');

      let retryText: string;
      try {
        const retry = await this.callOpenRouter(buildStrictMessages());
        retryText = retry.text;
        promptTokens += retry.promptTokens;
        completionTokens += retry.completionTokens;
      } catch (retryApiError) {
        throw this.wrapApiError(retryApiError, `${feature} retry call`);
      }

      try {
        return { parsed: parse(retryText), promptTokens, completionTokens };
      } catch {
        this.logger.error({ feature, retryText: retryText.slice(0, 300) }, 'Retry parse also failed');
        throw new UnprocessableEntityException('AI response could not be parsed after two attempts');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Parse + validate with a Zod schema
  // ─────────────────────────────────────────────────────────────────────────

  private parseWith<T>(schema: z.ZodType<T>, responseText: string): T {
    let cleaned = responseText.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Response is not valid JSON');
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${result.error.message}`);
    }
    return result.data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Activity-specific block semantic validation
  // ─────────────────────────────────────────────────────────────────────────

  private validateActivityBlocks(parsed: AiActivityResponse): void {
    for (const block of parsed.blocks) {
      const content = block.content as Record<string, unknown>;

      if (block.type === BlockType.POLL && 'correctOptionId' in content) {
        throw new Error('POLL block must not include correctOptionId');
      }

      if (block.type === BlockType.MULTIPLE_CHOICE) {
        const opts = (content.options as Array<{ id: string }> | undefined) ?? [];
        const ids = opts.map((o) => o.id);
        if (content.correctOptionId && !ids.includes(content.correctOptionId as string)) {
          throw new Error('MULTIPLE_CHOICE correctOptionId does not match any option id');
        }
      }

      if (block.type === BlockType.DRAG_DROP) {
        const itemIds = new Set(
          ((content.items as Array<{ id: string }>) ?? []).map((i) => i.id),
        );
        const targetIds = new Set(
          ((content.targets as Array<{ id: string }>) ?? []).map((t) => t.id),
        );
        for (const [k, v] of Object.entries(
          (content.correctMapping as Record<string, string>) ?? {},
        )) {
          if (!itemIds.has(k))
            throw new Error(`DRAG_DROP correctMapping key "${k}" not in items`);
          if (!targetIds.has(v as string))
            throw new Error(`DRAG_DROP correctMapping value "${v}" not in targets`);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Activity prompt helpers
  // ─────────────────────────────────────────────────────────────────────────

  private buildActivityMessages(
    dto: GenerateActivityDto,
    strict: boolean,
  ): Array<{ role: string; content: string }> {
    const systemPrompt = `You are an expert elementary curriculum designer with 15 years of classroom experience.
Your job is to produce structured, age-appropriate educational activities in valid JSON.

RULES (non-negotiable):
1. Return ONLY a raw JSON object. No markdown fences, no explanation, no preamble, no trailing text.
2. Every field in each block schema is required unless explicitly marked optional.
3. All "order" values must be unique, sequential integers starting at 0.
4. Use varied block types — do not repeat the same type more than twice in a row.
5. Vocabulary, sentence complexity, and question difficulty must exactly match the grade level.
6. Never embed correct answers inside question text or instruction text.
7. POLL blocks must never include a correctOptionId — they are ungraded opinion checks.
8. OPEN_ENDED blocks must include at least one allowedResponseType.
${strict ? '9. IMPORTANT: Your previous response failed JSON schema validation. Re-read every schema below carefully before responding.' : ''}`;

    const gradeContext = dto.gradeLevel
      ? `Grade level: ${gradeLabel(dto.gradeLevel)} — calibrate reading level, vocabulary, and cognitive demand accordingly.`
      : 'Grade level: not specified — use language appropriate for ages 7–9 (2nd–3rd grade).';

    const standardsContext =
      dto.standardsTags && dto.standardsTags.length > 0
        ? `Align content to these standards: ${dto.standardsTags.slice(0, 10).join(', ')}.`
        : '';

    const allowedBlockTypes =
      dto.blockTypes && dto.blockTypes.length > 0
        ? dto.blockTypes
        : Array.from(AI_GENERATABLE_BLOCK_TYPES);

    const blockHint =
      dto.blockTypes && dto.blockTypes.length > 0
        ? `Preferred block types (use these where appropriate): ${allowedBlockTypes.join(', ')}.`
        : 'Use a varied mix of block types — aim for at least 3 different types per activity.';

    const userPrompt = [
      'Generate a classroom activity on the following topic:',
      `"${dto.topic}"`,
      '',
      gradeContext,
      dto.subject ? `Subject area: ${dto.subject}.` : '',
      standardsContext,
      blockHint,
      '',
      this.blockSchemasPrompt(),
      this.outputSchemaPrompt(),
    ]
      .filter(Boolean)
      .join('\n');

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  private blockSchemasPrompt(): string {
    return `AVAILABLE BLOCK TYPES AND EXACT CONTENT SCHEMAS:

TEXT
  { "html": "<p>string</p>" }

MULTIPLE_CHOICE
  { "question": "string (max 1000)", "options": [{"id":"string","text":"string"}], "correctOptionId": "string", "allowMultipleCorrect": false }
  // 2–6 options; correctOptionId must match one option id

TRUE_FALSE
  { "question": "string (max 1000)", "correctAnswer": true | false }

POLL (no correct answer — never include correctOptionId)
  { "question": "string (max 1000)", "options": [{"id":"string","text":"string"}] }
  // 2–10 options

DRAG_DROP (auto-graded)
  { "instruction": "string (max 1000)", "items": [{"id":"string","label":"string"}], "targets": [{"id":"string","label":"string"}], "correctMapping": {"<itemId>":"<targetId>"} }
  // 2–20 items; 2–20 targets; every item id must appear in correctMapping

SHORT_ANSWER (teacher-graded)
  { "prompt": "string (max 1000)", "maxCharacters": 300, "placeholder": "optional string (max 200)" }

OPEN_ENDED (teacher-graded)
  { "prompt": "string (max 1000)", "allowedResponseTypes": ["text"], "maxVideoDurationSeconds": 300, "maxAudioDurationSeconds": 300 }
  // allowedResponseTypes: one or more of "text","audio","video","drawing","photo"

DRAWING_CANVAS (teacher-graded)
  { "backgroundImageUrl": null, "canvasWidthPx": 800, "canvasHeightPx": 600 }`;
  }

  private outputSchemaPrompt(): string {
    return `REQUIRED OUTPUT FORMAT:
{
  "suggestedTitle": "string, max 200 chars",
  "suggestedDescription": "optional string, max 1000 chars",
  "blocks": [
    { "type": "BLOCK_TYPE", "content": { /* matching schema */ }, "order": 0 }
  ]
}
Aim for 3–8 blocks. Order starts at 0 and increments by 1.`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Fluency calibration guide per grade
  // ─────────────────────────────────────────────────────────────────────────

  private fluencyCalibrationGuide(grade: GradeLevel): string {
    const guides: Record<string, string> = {
      PREK: 'Very simple sentences (3–5 words). Only common sight words. Short words only.',
      K: 'Simple sentences (5–8 words). Common sight words and phonics-controlled vocabulary. Very concrete topics.',
      G1: 'Short sentences (6–10 words). CVC words and common sight words. Simple narrative.',
      G2: 'Varied sentences (8–12 words). Common vocabulary, few multi-syllabic words. Simple compound sentences OK.',
      G3: 'Mix of simple and compound sentences (10–15 words). Grade-appropriate vocabulary including 2-3 syllable words. Simple figurative language OK.',
      G4: 'Complex sentences acceptable. Subject-specific vocabulary (pre-teach in keyVocabulary). 3-4 syllable words used naturally.',
      G5: 'Varied and complex sentences. Academic vocabulary appropriate. Informational text structures encouraged.',
    };
    return guides[grade] ?? 'Use grade-appropriate vocabulary and sentence length.';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Content extractors (used to build AI context from stored JSON)
  // ─────────────────────────────────────────────────────────────────────────

  private extractPromptText(content: Record<string, unknown>): string {
    // Handles all block types — extracts the primary human-readable text
    return (
      (content.question as string) ??
      (content.prompt as string) ??
      (content.instruction as string) ??
      (content.statement as string) ??
      (content.html as string)?.replace(/<[^>]+>/g, '').slice(0, 200) ??
      '(no prompt text)'
    );
  }

  private extractResponseText(
    blockType: BlockType,
    responseContent: Record<string, unknown>,
  ): string {
    // Converts stored response_content JSON into readable text for AI context
    switch (blockType) {
      case BlockType.MULTIPLE_CHOICE:
        return `Selected option: ${responseContent.selectedOptionId ?? '(none)'}`;
      case BlockType.TRUE_FALSE:
        return `Answered: ${responseContent.answer !== undefined ? String(responseContent.answer) : '(none)'}`;
      case BlockType.SHORT_ANSWER:
        return (responseContent.text as string) ?? '(no response)';
      case BlockType.OPEN_ENDED:
        if (responseContent.text) return responseContent.text as string;
        if (responseContent.audioUrl) return '(audio response submitted)';
        if (responseContent.videoUrl) return '(video response submitted)';
        if (responseContent.drawingUrl) return '(drawing response submitted)';
        if (responseContent.photoUrl) return '(photo response submitted)';
        return '(no response)';
      case BlockType.DRAWING_CANVAS:
        return responseContent.imageUrl ? '(drawing submitted)' : '(no drawing)';
      case BlockType.DRAG_DROP:
        return `Mapped items: ${JSON.stringify(responseContent.mapping ?? {})}`;
      case BlockType.POLL:
        return `Selected: ${responseContent.selectedOptionId ?? '(none)'}`;
      default:
        return '(response type not readable)';
    }
  }

  private extractCorrectAnswer(
    blockType: BlockType,
    content: Record<string, unknown>,
  ): string {
    switch (blockType) {
      case BlockType.MULTIPLE_CHOICE: {
        const options = content.options as Array<{ id: string; text: string }> | undefined;
        const correctId = content.correctOptionId as string | undefined;
        const correctOption = options?.find((o) => o.id === correctId);
        return correctOption ? correctOption.text : correctId ?? '(unknown)';
      }
      case BlockType.TRUE_FALSE:
        return String(content.correctAnswer);
      case BlockType.DRAG_DROP:
        return JSON.stringify(content.correctMapping ?? {});
      default:
        return '(not auto-gradeable)';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Authorization helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async assertTeacherOwnsClass(
    teacherId: string,
    classId: string,
  ): Promise<void> {
    const membership = await this.prisma.classTeacher.findFirst({
      where: { class_id: classId, teacher_id: teacherId, deleted_at: null },
    });
    if (!membership) {
      throw new ForbiddenException('Access denied — you are not a teacher in this class');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Rate limiting
  // ─────────────────────────────────────────────────────────────────────────

  private async assertDailyLimitNotReached(teacherId: string): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const usageCount = await this.prisma.aiUsageLog.count({
      where: { teacher_id: teacherId, created_at: { gte: today } },
    });

    if (usageCount >= this.DAILY_LIMIT) {
      this.logger.warn({ teacherId }, 'Daily AI generation limit reached');
      throw new HttpException('Daily AI usage limit reached', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async logUsage(
    teacherId: string,
    feature: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    try {
      await this.prisma.aiUsageLog.create({
        data: { teacher_id: teacherId, feature, prompt_tokens: promptTokens, completion_tokens: completionTokens },
      });
    } catch (err) {
      this.logger.error({ teacherId, feature, err }, 'Failed to write AI usage log');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Error mapping
  // ─────────────────────────────────────────────────────────────────────────

  private wrapApiError(error: unknown, context: string): HttpException {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;
      this.logger.error({ context, status, message: axiosErr.message }, 'OpenRouter API error');

      if (status === 429) {
        return new HttpException(
          'AI provider rate limit reached — please try again shortly',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (status && status >= 500) {
        return new HttpException('AI provider is temporarily unavailable', HttpStatus.BAD_GATEWAY);
      }
      if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
        return new HttpException(
          'AI provider did not respond in time — please try again',
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      return new BadRequestException(`AI provider error: ${axiosErr.message}`);
    }
    this.logger.error({ context, error }, 'Unexpected error calling OpenRouter');
    return new InternalServerErrorException('Unexpected error during AI operation');
  }
}