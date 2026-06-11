import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionStatus, Role } from '@prisma/client';
import { TeacherFeedbackDto, SaveAnnotationDto } from './dto';
import { SubmissionsService } from '../submissions/submissions.service';
import { JournalService } from '../journal/journal.service';
import { SubmissionStatusGateway } from '../activities/submission-status.gateway';

interface SubmissionWithDetails {
  id: string;
  student_id: string;
  status: SubmissionStatus;
  score: number | null;
  max_score: number | null;
  submitted_at: Date | null;
  student: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  blocks: Array<{
    id: string;
    block_id: string;
    auto_score: number | null;
    response_content: any;
  }>;
}

interface ClassAnalytics {
  submissionRate: number;
  averageScore: number | null;
  scoreDistribution: {
    range_0_25: number;
    range_26_50: number;
    range_51_75: number;
    range_76_100: number;
  };
}

interface StudentProgress {
  weeklySubmissions: Array<{
    week: string;
    count: number;
  }>;
  standardsMastery: Array<{
    tag: string;
    masteryPercentage: number;
  }>;
}

@Injectable()
export class AssessmentService {
  private readonly logger = new Logger(AssessmentService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SubmissionsService))
    private readonly submissionsService: SubmissionsService,
    @Inject(forwardRef(() => JournalService))
    private readonly journalService: JournalService,
    private submissionStatusGateway: SubmissionStatusGateway,
  ) {}

  /**
   * Get all submissions for an activity - used by teacher review panel
   * Also accessible by SCHOOL_ADMIN for safeguarding
   */
  async getAllSubmissions(
    activityId: string,
    requesterId: string,
    requesterRole: Role,
  ): Promise<SubmissionWithDetails[]> {
    // Verify activity exists and get class info
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId, deleted_at: null },
      include: {
        class: {
          include: {
            teachers: true,
            school: true,
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    // Authorization check
    if (requesterRole === Role.TEACHER) {
      // Teacher must own the class
      const isTeacher = activity.class.teachers.some(
        (t: any) => t.teacher_id === requesterId,
      );
      if (!isTeacher) {
        throw new ForbiddenException(
          'You do not have access to this activity',
        );
      }
    } else if (requesterRole === Role.SCHOOL_ADMIN) {
      // School admin must be in the same school
      const admin = await this.prisma.user.findUnique({
        where: { id: requesterId, deleted_at: null },
      });
      if (!admin || admin.school_id !== activity.class.school_id) {
        throw new ForbiddenException(
          'You do not have access to this activity',
        );
      }
    } else {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Fetch all submissions with student info and block scores
    const submissions = await this.prisma.submission.findMany({
      where: {
        activity_id: activityId,
      },
      include: {
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        blocks: {
          select: {
            id: true,
            block_id: true,
            auto_score: true,
            response_content: true,
          },
          orderBy: {
            created_at: 'asc',
          },
        },
      },
      orderBy: {
        student: {
          last_name: 'asc',
        },
      },
    });

    return submissions;
  }

  /**
   * Update feedback on a submission (status + text/audio feedback)
   * Delegates to SubmissionsService for consistency
   */
  async updateFeedback(
    submissionId: string,
    teacherId: string,
    dto: TeacherFeedbackDto,
  ) {
    // Verify teacher owns activity's class
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          include: {
            class: {
              include: {
                teachers: true,
              },
            },
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.activity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'You do not have access to this submission',
      );
    }

    // Delegate to SubmissionsService which handles:
    // - Status update
    // - WebSocket notification
    // - Journal post creation on APPROVED
    // - Push notification queuing (when module is built)
    return this.submissionsService.updateFeedback(submissionId, teacherId, dto);
  }

  /**
   * Save teacher annotation on a submission block (drawing overlay, markup)
   */
  async saveAnnotation(
    submissionId: string,
    teacherId: string,
    dto: SaveAnnotationDto,
  ) {
    // Verify teacher owns activity's class
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          include: {
            class: {
              include: {
                teachers: true,
              },
            },
          },
        },
        blocks: {
          where: {
            block_id: dto.block_id,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.activity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'You do not have access to this submission',
      );
    }

    const block = submission.blocks[0];
    if (!block) {
      throw new NotFoundException(
        'Submission block not found for this block_id',
      );
    }

    // Upsert annotation_json on the SubmissionBlock
    const updated = await this.prisma.submissionBlock.update({
      where: { id: block.id },
      data: {
        annotation_json: dto.annotation_json,
      },
    });

    return updated;
  }

  /**
   * Get annotation for a specific submission block
   */
  async getAnnotation(
    submissionId: string,
    blockId: string,
    teacherId: string,
  ): Promise<{ annotation_json: string | null }> {
    // Verify teacher owns activity's class
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          include: {
            class: {
              include: {
                teachers: true,
              },
            },
          },
        },
        blocks: {
          where: {
            block_id: blockId,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.activity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'You do not have access to this submission',
      );
    }

    const block = submission.blocks[0];
    if (!block) {
      throw new NotFoundException(
        'Submission block not found for this block_id',
      );
    }

    return {
      annotation_json: block.annotation_json,
    };
  }

  /**
   * Get class-level analytics (submission rate, avg score, score distribution)
   */
  async getClassAnalytics(
    classId: string,
    teacherId: string,
  ): Promise<ClassAnalytics> {
    // Verify teacher owns class - use findFirst to avoid deleted_at in unique where
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: classId,
        teacher_id: teacherId,
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException('You do not have access to this class');
    }

    // Get all activities for this class
    const activities = await this.prisma.activity.findMany({
      where: {
        class_id: classId,
        deleted_at: null,
        status: 'PUBLISHED',
      },
      select: {
        id: true,
      },
    });

    const activityIds = activities.map((a) => a.id);

    // Count total assignments (WHOLE_CLASS assignments count per student)
    const totalStudents = await this.prisma.classStudent.count({
      where: {
        class_id: classId,
        is_active: true,
      },
    });

    const wholeClassActivities = await this.prisma.activity.count({
      where: {
        class_id: classId,
        deleted_at: null,
        status: 'PUBLISHED',
        assigned_to: 'WHOLE_CLASS',
      },
    });

    const individualAssignments = await this.prisma.activityAssignment.count({
      where: {
        activity_id: { in: activityIds },
      },
    });

    const totalAssignments =
      wholeClassActivities * totalStudents + individualAssignments;

    // Count completed submissions (SUBMITTED or APPROVED)
    const completedSubmissions = await this.prisma.submission.count({
      where: {
        activity_id: { in: activityIds },
        status: { in: ['SUBMITTED', 'APPROVED'] },
      },
    });

    const submissionRate =
      totalAssignments > 0
        ? Math.round((completedSubmissions / totalAssignments) * 100)
        : 0;

    // Calculate average score
    const scoreAgg = await this.prisma.submission.aggregate({
      where: {
        activity_id: { in: activityIds },
        score: { not: null },
      },
      _avg: {
        score: true,
      },
    });

    const averageScore = scoreAgg._avg.score
      ? Math.round(scoreAgg._avg.score * 10) / 10
      : null;

    // Score distribution (histogram buckets)
    const submissions = await this.prisma.submission.findMany({
      where: {
        activity_id: { in: activityIds },
        score: { not: null },
        max_score: { not: null, gt: 0 },
      },
      select: {
        score: true,
        max_score: true,
      },
    });

    const distribution = {
      range_0_25: 0,
      range_26_50: 0,
      range_51_75: 0,
      range_76_100: 0,
    };

    submissions.forEach((sub) => {
      if (sub.score === null || sub.max_score === null) return;
      const percentage = (sub.score / sub.max_score) * 100;
      if (percentage <= 25) distribution.range_0_25++;
      else if (percentage <= 50) distribution.range_26_50++;
      else if (percentage <= 75) distribution.range_51_75++;
      else distribution.range_76_100++;
    });

    return {
      submissionRate,
      averageScore,
      scoreDistribution: distribution,
    };
  }

  /**
   * Get student progress (weekly submission counts + per-standards-tag mastery)
   */
  async getStudentProgress(
    studentId: string,
    teacherId: string,
  ): Promise<StudentProgress> {
    // Verify teacher has student in a class
    const classTeacherStudent = await this.prisma.classStudent.findFirst({
      where: {
        student_id: studentId,
        is_active: true,
        class: {
          teachers: {
            some: {
              teacher_id: teacherId,
            },
          },
        },
      },
    });

    if (!classTeacherStudent) {
      throw new ForbiddenException(
        'You do not have access to this student',
      );
    }

    // Weekly submission counts (last 30 days, grouped by week)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const submissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
        submitted_at: { gte: thirtyDaysAgo },
        status: { in: ['SUBMITTED', 'APPROVED'] },
      },
      select: {
        submitted_at: true,
      },
      orderBy: {
        submitted_at: 'asc',
      },
    });

    // Group by week (ISO week start Monday)
    const weekCounts = new Map<string, number>();
    submissions.forEach((sub) => {
      if (!sub.submitted_at) return;
      const date = new Date(sub.submitted_at);
      const weekStart = new Date(date);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Monday
      weekStart.setDate(diff);
      const weekKey = weekStart.toISOString().split('T')[0];
      weekCounts.set(weekKey, (weekCounts.get(weekKey) || 0) + 1);
    });

    const weeklySubmissions = Array.from(weekCounts.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Per-standards-tag mastery (correct blocks / total blocks for that tag)
    const studentSubmissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
        status: { in: ['SUBMITTED', 'APPROVED'] },
        activity: {
          deleted_at: null,
        },
      },
      include: {
        blocks: {
          select: {
            block_id: true,
            auto_score: true,
          },
        },
        activity: {
          select: {
            standards_tags: true,
            blocks: {
              select: {
                id: true,
                type: true,
              },
            },
          },
        },
      },
    });

    // Build tag → mastery map
    const tagStats = new Map<
      string,
      { correct: number; total: number }
    >();

    studentSubmissions.forEach((submission) => {
      const tags = submission.activity.standards_tags || [];
      if (tags.length === 0) return;

      // Count auto-gradeable blocks
      const autoGradeableTypes = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'DRAG_DROP'];
      const autoGradeableBlocks = submission.activity.blocks.filter((b) =>
        autoGradeableTypes.includes(b.type),
      );

      if (autoGradeableBlocks.length === 0) return;

      // For each tag, track correct/total
      tags.forEach((tag) => {
        if (!tagStats.has(tag)) {
          tagStats.set(tag, { correct: 0, total: 0 });
        }
        const stats = tagStats.get(tag)!;

        autoGradeableBlocks.forEach((activityBlock) => {
          const submissionBlock = submission.blocks.find(
            (sb) => sb.block_id === activityBlock.id,
          );
          if (submissionBlock) {
            stats.total++;
            // Consider block correct if auto_score >= 1
            if (submissionBlock.auto_score && submissionBlock.auto_score >= 1) {
              stats.correct++;
            }
          }
        });
      });
    });

    const standardsMastery = Array.from(tagStats.entries())
      .map(([tag, stats]) => ({
        tag,
        masteryPercentage:
          stats.total > 0
            ? Math.round((stats.correct / stats.total) * 100)
            : 0,
      }))
      .sort((a, b) => b.masteryPercentage - a.masteryPercentage);

    return {
      weeklySubmissions,
      standardsMastery,
    };
  }
}
