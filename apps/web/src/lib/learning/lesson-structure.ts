export interface LessonLexiconItem {
  term: string;
  definition: string;
}

export interface LessonScenarioItem {
  type: string;
  description: string;
}

export interface LessonExperience {
  schema: 'lesson-experience-v1';
  meta: {
    title: string;
    readingTimeMinutes: number;
    difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  };
  introduction: string;
  learningObjectives: string[];
  lexicon: LessonLexiconItem[];
  technicalDeepDive: {
    heading: string;
    caseLawCitation: string;
    coreDoctrine: string;
    scenarios: LessonScenarioItem[];
  };
  fieldExecution: {
    strategyName: string;
    script: string;
  };
}

export function createDefaultLessonExperience(title: string): LessonExperience {
  return {
    schema: 'lesson-experience-v1',
    meta: {
      title,
      readingTimeMinutes: 10,
      difficulty: 'Advanced',
    },
    introduction: '',
    learningObjectives: [],
    lexicon: [],
    technicalDeepDive: {
      heading: '',
      caseLawCitation: '',
      coreDoctrine: '',
      scenarios: [],
    },
    fieldExecution: {
      strategyName: '',
      script: '',
    },
  };
}

function isDifficulty(value: unknown): value is 'Beginner' | 'Intermediate' | 'Advanced' {
  return value === 'Beginner' || value === 'Intermediate' || value === 'Advanced';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0);
}

export function parseLessonExperience(body: string | null | undefined, fallbackTitle: string): LessonExperience | null {
  if (!body || !body.trim().startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.schema !== 'lesson-experience-v1') {
      return null;
    }

    const meta = typeof parsed.meta === 'object' && parsed.meta !== null
      ? parsed.meta as Record<string, unknown>
      : {};

    const deepDive = typeof parsed.technicalDeepDive === 'object' && parsed.technicalDeepDive !== null
      ? parsed.technicalDeepDive as Record<string, unknown>
      : {};

    const fieldExecution = typeof parsed.fieldExecution === 'object' && parsed.fieldExecution !== null
      ? parsed.fieldExecution as Record<string, unknown>
      : {};

    const lexiconRaw = Array.isArray(parsed.lexicon) ? parsed.lexicon : [];
    const lexicon = lexiconRaw
      .map((item) => {
        const value = typeof item === 'object' && item !== null ? item as Record<string, unknown> : null;
        if (!value) return null;
        const term = asString(value.term);
        const definition = asString(value.definition);
        if (!term || !definition) return null;
        return { term, definition };
      })
      .filter((item): item is LessonLexiconItem => item !== null);

    const scenarioRaw = Array.isArray(deepDive.scenarios) ? deepDive.scenarios : [];
    const scenarios = scenarioRaw
      .map((item) => {
        const value = typeof item === 'object' && item !== null ? item as Record<string, unknown> : null;
        if (!value) return null;
        const type = asString(value.type);
        const description = asString(value.description);
        if (!type || !description) return null;
        return { type, description };
      })
      .filter((item): item is LessonScenarioItem => item !== null);

    const difficulty = isDifficulty(meta.difficulty) ? meta.difficulty : 'Advanced';
    const readingTimeRaw = Number(meta.readingTimeMinutes);

    return {
      schema: 'lesson-experience-v1',
      meta: {
        title: asString(meta.title) || fallbackTitle,
        readingTimeMinutes: Number.isFinite(readingTimeRaw) && readingTimeRaw > 0 ? Math.round(readingTimeRaw) : 10,
        difficulty,
      },
      introduction: asString(parsed.introduction),
      learningObjectives: asStringArray(parsed.learningObjectives),
      lexicon,
      technicalDeepDive: {
        heading: asString(deepDive.heading),
        caseLawCitation: asString(deepDive.caseLawCitation),
        coreDoctrine: asString(deepDive.coreDoctrine),
        scenarios,
      },
      fieldExecution: {
        strategyName: asString(fieldExecution.strategyName),
        script: asString(fieldExecution.script),
      },
    };
  } catch {
    return null;
  }
}

export function serializeLessonExperience(value: LessonExperience): string {
  return JSON.stringify(value, null, 2);
}
