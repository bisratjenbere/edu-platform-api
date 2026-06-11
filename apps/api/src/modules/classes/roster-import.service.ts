import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parse } from 'csv-parse/sync';
import { GradeLevel, Role } from '@prisma/client';

interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  gradeLevel?: GradeLevel;
}

export interface RosterImportResult {
  added: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

@Injectable()
export class RosterImportService {
  constructor(private prisma: PrismaService) {}

  /**
   * Import students from CSV file
   */
  async import(
    classId: string,
    teacherId: string,
    schoolId: string,
    fileBuffer: Buffer,
  ): Promise<RosterImportResult> {
    // Verify teacher access
    const classTeacher = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!classTeacher) {
      throw new BadRequestException('Class not found or access denied');
    }

    // Parse CSV
    let records: any[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      throw new BadRequestException('Invalid CSV format');
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    if (records.length > 50) {
      // TODO: Implement async processing with BullMQ for > 50 rows
      throw new BadRequestException('CSV imports larger than 50 rows are not yet supported');
    }

    // Validate and process rows
    const result: RosterImportResult = {
      added: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2; // +2 because: 1-indexed and header is row 1

      try {
        // Validate required fields
        if (!row.firstName || !row.lastName) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            reason: 'Missing firstName or lastName',
          });
          continue;
        }

        if (!row.email) {
          result.failed++;
          result.errors.push({
            row: rowNumber,
            reason: 'Missing email',
          });
          continue;
        }

        // Validate grade level if provided
        let gradeLevel: GradeLevel | undefined;
        if (row.gradeLevel) {
          if (!Object.values(GradeLevel).includes(row.gradeLevel as GradeLevel)) {
            result.failed++;
            result.errors.push({
              row: rowNumber,
              reason: `Invalid grade level: ${row.gradeLevel}`,
            });
            continue;
          }
          gradeLevel = row.gradeLevel as GradeLevel;
        }

        // Find or create user
        let user = await this.prisma.user.findUnique({
          where: {
            email: row.email,
            deleted_at: null,
          },
        });

        let wasUpdated = false;

        if (user) {
          // Update existing user if name changed
          if (user.first_name !== row.firstName || user.last_name !== row.lastName) {
            user = await this.prisma.user.update({
              where: { id: user.id },
              data: {
                first_name: row.firstName,
                last_name: row.lastName,
              },
            });
            wasUpdated = true;
          }
        } else {
          // Create new user
          user = await this.prisma.user.create({
            data: {
              email: row.email,
              first_name: row.firstName,
              last_name: row.lastName,
              role: Role.STUDENT,
              school_id: schoolId,
              is_active: true,
            },
          });
        }

        // Add to class (or reactivate)
        const existingStudent = await this.prisma.classStudent.findUnique({
          where: {
            class_id_student_id: {
              class_id: classId,
              student_id: user.id,
            },
          },
        });

        if (existingStudent) {
          if (!existingStudent.is_active) {
            await this.prisma.classStudent.update({
              where: {
                class_id_student_id: {
                  class_id: classId,
                  student_id: user.id,
                },
              },
              data: {
                is_active: true,
              },
            });
            result.added++;
          } else if (wasUpdated) {
            result.updated++;
          } else {
            // Already in class, no changes
            result.updated++;
          }
        } else {
          await this.prisma.classStudent.create({
            data: {
              class_id: classId,
              student_id: user.id,
              avatar_emoji: '🐶',
              is_active: true,
            },
          });
          result.added++;
        }
      } catch (error: any) {
        result.failed++;
        result.errors.push({
          row: rowNumber,
          reason: error.message || 'Unknown error',
        });
      }
    }

    return result;
  }
}
