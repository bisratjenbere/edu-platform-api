import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockType } from '@prisma/client';

@Injectable()
export class AutoGradeService {
  private readonly logger = new Logger(AutoGradeService.name);

  constructor(private prisma: PrismaService) {}

  async grade(submissionId: string): Promise<{ score: number; maxScore: number }> {
    this.logger.log(`Auto-grading submission ${submissionId}`);

    // Get submission with blocks and activity blocks
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        blocks: true,
        activity: {
          include: {
            blocks: true,
          },
        },
      },
    });

    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    let totalScore = 0;
    let gradeableBlockCount = 0;

    // Grade each submission block
    for (const submissionBlock of submission.blocks) {
      const activityBlock = submission.activity.blocks.find(
        (ab) => ab.id === submissionBlock.block_id,
      );

      if (!activityBlock) {
        this.logger.warn(
          `Activity block ${submissionBlock.block_id} not found for submission block ${submissionBlock.id}`,
        );
        continue;
      }

      const score = this.gradeBlock(
        activityBlock.type,
        activityBlock.content as any,
        submissionBlock.response_content as any,
      );

      if (score !== null) {
        gradeableBlockCount++;
        totalScore += score;

        // Update submission block with auto_score
        await this.prisma.submissionBlock.update({
          where: { id: submissionBlock.id },
          data: { auto_score: score },
        });
      }
    }

    // Update submission with total score and max score
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        score: totalScore,
        max_score: gradeableBlockCount,
      },
    });

    this.logger.log(
      `Graded submission ${submissionId}: ${totalScore}/${gradeableBlockCount}`,
    );

    return { score: totalScore, maxScore: gradeableBlockCount };
  }

  private gradeBlock(
    blockType: BlockType,
    activityContent: any,
    responseContent: any,
  ): number | null {
    switch (blockType) {
      case BlockType.MULTIPLE_CHOICE:
        return this.gradeMultipleChoice(activityContent, responseContent);

      case BlockType.TRUE_FALSE:
        return this.gradeTrueFalse(activityContent, responseContent);

      case BlockType.DRAG_DROP:
        return this.gradeDragDrop(activityContent, responseContent);

      default:
        // Not auto-gradeable (POLL, SHORT_ANSWER, OPEN_ENDED, instruction blocks)
        return null;
    }
  }

  private gradeMultipleChoice(
    activityContent: any,
    responseContent: any,
  ): number {
    const correctOptionId = activityContent.correctOptionId;
    const selectedOptionId = responseContent.selectedOptionId;

    return selectedOptionId === correctOptionId ? 1 : 0;
  }

  private gradeTrueFalse(activityContent: any, responseContent: any): number {
    const correctAnswer = activityContent.correctAnswer;
    const studentAnswer = responseContent.answer;

    return studentAnswer === correctAnswer ? 1 : 0;
  }

  private gradeDragDrop(activityContent: any, responseContent: any): number {
    const correctMapping = activityContent.correctMapping as Record<
      string,
      string
    >;
    const studentMapping = responseContent.mapping as Record<string, string>;

    if (!correctMapping || !studentMapping) {
      return 0;
    }

    const totalPairs = Object.keys(correctMapping).length;
    if (totalPairs === 0) {
      return 0;
    }

    let correctPairs = 0;
    for (const [itemId, targetId] of Object.entries(correctMapping)) {
      if (studentMapping[itemId] === targetId) {
        correctPairs++;
      }
    }

    // Partial credit: round to 2 decimal places
    const score = correctPairs / totalPairs;
    return Math.round(score * 100) / 100;
  }
}
