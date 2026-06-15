---
inclusion: fileMatch
fileMatchPattern: ["**/*.tsx", "**/*.jsx", "**/components/**", "**/app/**"]
---

# EduFlow — Frontend Standards

## Component anatomy

```tsx
// Every component follows this structure
'use client'; // only when using hooks or browser APIs

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils'; // shadcn/ui utility

interface DrawingCanvasProps {
  backgroundImage?: string;
  readOnly?: boolean;
  onSave: (fabricJson: string, previewDataUrl: string) => void;
}

export function DrawingCanvas({ backgroundImage, readOnly = false, onSave }: DrawingCanvasProps) {
  // 1. State (useState, useReducer)
  // 2. Refs (useRef)
  // 3. Custom hooks
  // 4. TanStack Query (data fetching)
  // 5. Zustand store selectors
  // 6. Event handlers (defined as const arrow functions)
  // 7. Effects (useEffect) — always last
  // 8. Early returns for loading/error states
  // 9. JSX return

  return (
    <div className="relative w-full h-full">
      {/* content */}
    </div>
  );
}
```

## Tailwind rules

- Never use arbitrary values like `w-[342px]` unless absolutely necessary
- Use semantic spacing: `gap-2`, `gap-4`, `p-4`, `p-6`
- Responsive: mobile-first, use `sm:`, `md:`, `lg:` breakpoints
- Dark mode: use CSS variables via shadcn/ui — never hardcode colors
- Touch targets: minimum `min-h-[44px] min-w-[44px]` on all interactive elements (WCAG + Apple HIG)

## shadcn/ui usage

Use shadcn/ui components for all standard UI elements:
- Inputs → `<Input />`
- Buttons → `<Button variant="default|outline|ghost|destructive" />`
- Modals → `<Dialog />` + `<DialogContent />`
- Selects → `<Select />`
- Date pickers → shadcn calendar component
- Data tables → TanStack Table v8 wrapped in shadcn `<Table />`
- Toasts → `<Sonner />` (shadcn toast)
- Badges → `<Badge variant="default|secondary|destructive|outline" />`

## TanStack Query patterns

```tsx
// Fetching data
const { data, isLoading, error } = useQuery({
  queryKey: ['activities', classId],
  queryFn: () => api.activities.list(classId),
  staleTime: 30_000,
});

// Mutations
const { mutate, isPending } = useMutation({
  mutationFn: (dto: CreateActivityDto) => api.activities.create(dto),
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['activities'] });
    toast.success('Activity created');
  },
  onError: (error) => {
    toast.error(error.message);
  },
});
```

## Zustand store pattern

```typescript
// stores/activityBuilderStore.ts
interface ActivityBuilderState {
  blocks: ActivityBlock[];
  isDirty: boolean;
  addBlock: (block: ActivityBlock) => void;
  removeBlock: (blockId: string) => void;
  reorderBlocks: (blocks: ActivityBlock[]) => void;
  setDirty: (dirty: boolean) => void;
}

export const useActivityBuilderStore = create<ActivityBuilderState>((set) => ({
  blocks: [],
  isDirty: false,
  addBlock: (block) => set((s) => ({ blocks: [...s.blocks, block], isDirty: true })),
  removeBlock: (blockId) => set((s) => ({
    blocks: s.blocks.filter((b) => b.id !== blockId),
    isDirty: true,
  })),
  reorderBlocks: (blocks) => set({ blocks, isDirty: true }),
  setDirty: (isDirty) => set({ isDirty }),
}));
```

## Loading states — always use skeletons, never spinners alone

```tsx
// Loading state
if (isLoading) return <StudentCardSkeleton count={12} />;

// Error state — always show actionable message
if (error) return (
  <div className="flex flex-col items-center gap-3 py-12">
    <p className="text-muted-foreground">Failed to load activities</p>
    <Button variant="outline" onClick={() => refetch()}>Try again</Button>
  </div>
);

// Empty state — never show blank screen
if (!data?.length) return (
  <div className="flex flex-col items-center gap-3 py-12">
    <p className="text-muted-foreground">No activities yet</p>
    <Button onClick={onCreateFirst}>Create your first activity</Button>
  </div>
);
```

## Accessibility requirements (WCAG 2.1 AA)

- All images: `alt` attribute (empty `alt=""` for decorative images)
- All icon buttons: `aria-label`
- All form inputs: associated `<label>` or `aria-label`
- All modals: `aria-labelledby` pointing to dialog title
- Keyboard navigation: all interactive elements reachable via Tab
- Focus visible: never remove `outline` without providing custom focus indicator
- Minimum contrast: 4.5:1 for normal text, 3:1 for large text

## Age-appropriate UI (for student-facing components)

- Icon-based navigation for K–2 (no text labels required)
- Touch targets minimum 56×56px on student-facing UI (larger than standard)
- High contrast, bright colors for young learners
- Audio instructions option on every activity block
- No small text — minimum 16px on student interface
