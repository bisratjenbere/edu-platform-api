---
inclusion: fileMatch
fileMatchPattern: ["**/*.controller.ts", "**/*.dto.ts", "**/dto/**"]
---

# EduFlow — API Standards

## Response envelope — use this on every endpoint

```typescript
// Success response
return {
  success: true,
  data: result,
  error: null,
};

// Error response (thrown via HttpException or global filter)
return {
  success: false,
  data: null,
  error: 'Human-readable error message',
};

// Paginated response
return {
  success: true,
  data: items,
  error: null,
  meta: {
    cursor: lastItem?.id ?? null,
    hasMore: items.length === limit,
    total: totalCount, // only for admin tables
  },
};
```

## Pagination patterns

### Cursor-based (feeds, journals, messages, submissions)
```typescript
// Query params
@IsOptional() @IsString() cursor?: string;
@IsOptional() @IsInt() @Min(1) @Max(100) limit?: number = 20;

// Prisma query
const items = await this.prisma.journalPost.findMany({
  where: { student_id: studentId, deleted_at: null },
  take: limit + 1, // fetch one extra to determine hasMore
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  orderBy: { created_at: 'desc' },
});
const hasMore = items.length > limit;
if (hasMore) items.pop();
const nextCursor = hasMore ? items[items.length - 1].id : null;
```

### Offset-based (admin tables only)
```typescript
@IsOptional() @IsInt() @Min(1) page?: number = 1;
@IsOptional() @IsInt() @Min(1) @Max(100) limit?: number = 20;
const skip = (page - 1) * limit;
```

## DTO standards

```typescript
// Every DTO must use class-validator decorators
export class CreateActivityDto {
  @ApiProperty({ description: 'Activity title', example: 'Water Cycle Quiz' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiProperty({ enum: AssignedTo })
  @IsEnum(AssignedTo)
  assigned_to: AssignedTo;
}
```

## Controller standards

```typescript
@ApiTags('activities')
@Controller('api/v1/activities')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Create a new activity (draft)' })
  @ApiResponse({ status: 201, description: 'Activity created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Body() dto: CreateActivityDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<Activity>> {
    const activity = await this.activitiesService.create(req.user.id, dto);
    return { success: true, data: activity, error: null };
  }
}
```

## HTTP status codes — use these consistently

| Situation | Status |
|---|---|
| Created successfully | 201 |
| Retrieved / updated | 200 |
| Deleted | 204 (no body) |
| Validation error | 400 |
| Unauthenticated | 401 |
| Forbidden (no permission) | 403 |
| Not found | 404 |
| Duplicate / conflict | 409 |
| Server error | 500 |

## Filtering and searching conventions

- Always use query params for filtering: `?classId=&status=&gradeLevel=`
- Search query param: always named `q`
- Sort param: `sortBy=created_at&sortOrder=desc`
- Date range: `fromDate=2026-01-01&toDate=2026-06-01`
- All filter params are optional — return unfiltered results if not provided
