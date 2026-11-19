import { expect, test } from './workspace-fixtures';

test('course overview uses the selected database course and resumes the learner lesson', async ({ page }) => {
  const courseId = 'course-dynamic-1';
  await page.route('**/api/learning/courses/list', (route) => route.fulfill({ json: { courses: [
    { id: courseId, title: 'Dynamic course', description: 'Database-backed course', level: 'INTERMEDIATE', modules: [
      { id: 'module-a', title: 'Foundations', order: 1, lessons: [
        { id: 'lesson-a', title: 'First lesson', order: 1 },
        { id: 'lesson-b', title: 'Resume lesson', order: 2 },
      ] },
      { id: 'module-b', title: 'Application', order: 2, lessons: [
        { id: 'lesson-c', title: 'Final lesson', order: 1 },
      ] },
    ] },
  ] } }));
  await page.route('**/api/learning/progress/get', (route) => route.fulfill({ json: { progress: [
    { lessonId: 'lesson-a', completed: true, percent: 100, score: 100, lastViewedAt: '2026-11-01T10:00:00Z' },
    { lessonId: 'lesson-b', completed: false, percent: 35, score: null, lastViewedAt: '2026-11-02T10:00:00Z' },
  ] } }));

  await page.goto(`/learning/course/${courseId}/overview`);
  await expect(page.getByRole('heading', { name: 'Dynamic course', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue', exact: true })).toHaveAttribute(
    'href',
    '/learning/lesson/lesson-b?lessonId=lesson-b',
  );
  await expect(page.getByRole('link', { name: 'Open lesson', exact: true })).toHaveCount(3);
  await expect(page.getByText('First lesson', { exact: true })).toBeVisible();
  await expect(page.getByText('Final lesson', { exact: true })).toBeVisible();
});

test('static Module 11 completion returns to Learning Center instead of a missing Module 12', async ({ page }) => {
  await page.goto('/learning/module/11/complete');
  await expect(page.getByRole('link', { name: 'Back to Learning Center', exact: true })).toHaveAttribute('href', '/learning');
  await expect(page.locator('a[href="/learning/module/12"]')).toHaveCount(0);
});

test('course builder reports failed creation without clearing the draft, then reloads after success', async ({ page }) => {
  const courses = [{
    id: 'course-existing',
    title: 'Existing course',
    level: 'BEGINNER',
    modules: [],
  }];
  let createAttempts = 0;

  await page.route('**/api/learning/courses/list', (route) => route.fulfill({ json: { courses } }));
  await page.route('**/api/learning/courses/import/contractor-liability-master', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/learning/courses/create', async (route) => {
    createAttempts += 1;
    if (createAttempts === 1) {
      await route.fulfill({ status: 500, json: { message: 'Course save failed.' } });
      return;
    }

    const body = route.request().postDataJSON() as { title: string; description: string; level: string };
    courses.push({ id: 'course-created', title: body.title, level: body.level, modules: [] });
    await route.fulfill({ status: 201, json: { course: { id: 'course-created' } } });
  });

  await page.goto('/learning/course-builder');
  await page.getByRole('heading', { name: 'Course Builder' }).waitFor();
  await page.getByPlaceholder('Course title').fill('New course');
  await page.getByPlaceholder('Description').fill('Course description');
  await page.getByRole('button', { name: '+ Create Course' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Course save failed.');
  await expect(page.getByPlaceholder('Course title')).toHaveValue('New course');
  await expect(page.getByPlaceholder('Description')).toHaveValue('Course description');

  await page.getByRole('button', { name: '+ Create Course' }).click();
  await expect(page.getByPlaceholder('Course title')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'New course' })).toBeVisible();
});

test('course snapshot restore reports failure and refreshes the course after success', async ({ page }) => {
  let title = 'Before restore';
  let restoreAttempts = 0;
  const courseList = () => ({ courses: [{
    id: 'course-snapshot',
    title,
    description: 'Snapshot test course',
    level: 'BEGINNER',
    modules: [{ id: 'module-snapshot', title: 'Current module', order: 0, lessons: [] }],
  }] });

  await page.route('**/api/learning/courses/list', (route) => route.fulfill({ json: courseList() }));
  await page.route('**/api/learning/snapshots/list?courseId=course-snapshot', (route) => route.fulfill({ json: {
    snapshots: [{ id: 'snapshot-1', label: 'Saved version', createdAt: '2026-11-01T10:00:00Z' }],
  } }));
  await page.route('**/api/learning/snapshots/restore', async (route) => {
    restoreAttempts += 1;
    if (restoreAttempts === 1) {
      await route.fulfill({ status: 500, json: { message: 'Snapshot restore failed.' } });
      return;
    }

    title = 'Restored course';
    await route.fulfill({ json: { success: true } });
  });

  await page.goto('/learning/course-builder/course-snapshot');
  await expect(page.getByRole('heading', { name: 'Before restore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore: Saved version', exact: true }).click();
  await expect(page.getByText('Snapshot restore failed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Before restore', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Restore: Saved version', exact: true }).click();
  await expect(page.getByText('Course snapshot restored.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restored course', exact: true })).toBeVisible();
});

test('static assessment results are saved to the agent and remain visible after reload', async ({ page }) => {
  const attempts: Array<{ id: string; score: number; questionCount: number; createdAt: string }> = [];
  let failFirstSave = true;
  await page.route('**/api/learning/static-assessments/1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { attempts } });
      return;
    }

    if (failFirstSave) {
      failFirstSave = false;
      await route.fulfill({ status: 500, json: { message: 'Practice result could not be saved. Retry before leaving this page.' } });
      return;
    }

    const body = route.request().postDataJSON() as { score: number; questionCount: number };
    const attempt = {
      id: 'attempt-1',
      score: body.score,
      questionCount: body.questionCount,
      createdAt: '2026-11-05T12:00:00.000Z',
    };
    attempts.unshift(attempt);
    await route.fulfill({ status: 201, json: { attempt } });
  });

  await page.goto('/learning/module/1/assessment');
  for (const [question, answer] of [
    ['Which legal system governs negligence', 'A. Tort Law'],
    ['A contractor misreads a blueprint', 'C. Contractual Loss'],
    ['Under ISO CG 00 01', 'B. Bodily injury or property damage'],
    ['What does the Economic Loss Rule', 'B. Recovery of purely financial losses in tort'],
    ['Which Arizona case is foundational', 'B. Flagstaff Affordable Housing v. Design Alliance'],
    ['A subcontractor installs flooring', 'B. Contractors E and O'],
    ['Which legal pathway governs licensing', 'C. Statutory Law'],
    ['A roofer drops a tool', 'B. Physical Loss'],
    ['Which coverage lane may respond', 'A. CGL Coverage A'],
    ['Which exposure is generally non-insurable', 'B. Statutory fines and penalties'],
  ]) {
    await page.getByText(question, { exact: false }).locator('..')
      .getByRole('button', { name: answer, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Submit Assessment', exact: true }).click();
  await expect(page.getByText('You scored 10/10 (100%).', { exact: true })).toBeVisible();
  await expect(page.locator('p[role="alert"]')).toContainText('Practice result could not be saved');
  await page.getByRole('button', { name: 'Retry saving result', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Latest saved practice result: 100%');

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Latest saved practice result: 100%');
});
