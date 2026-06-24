import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import { and, asc, count, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { db } from "../db/client.js";
import {
  type McqOption,
  questions,
  type QuestionRow,
} from "../db/schema/tests.js";
import { AppError } from "../lib/errors.js";
import { assertTestMutable, findOrgTest } from "../lib/test-access.js";
import { validate } from "../lib/validate.js";

const QuestionType = Type.Union([
  Type.Literal("mcq_single"),
  Type.Literal("mcq_multiple"),
]);
const GradingMode = Type.Union([
  Type.Literal("all_or_nothing"),
  Type.Literal("partial"),
]);

const OptionInput = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 1000 }),
  imageUrl: Type.Optional(Type.String({ maxLength: 2000 })),
  correct: Type.Boolean(),
});

const CreateQuestionBody = Type.Object(
  {
    type: QuestionType,
    prompt: Type.String({ minLength: 1, maxLength: 10000 }),
    imageUrl: Type.Optional(Type.String({ maxLength: 2000 })),
    points: Type.Optional(Type.Integer({ minimum: 1 })),
    negativeMarking: Type.Optional(Type.Boolean()),
    gradingMode: Type.Optional(GradingMode),
    position: Type.Optional(Type.Integer({ minimum: 0 })),
    options: Type.Array(OptionInput, { minItems: 2, maxItems: 26 }),
  },
  { additionalProperties: false },
);

const UpdateQuestionBody = Type.Partial(CreateQuestionBody, {
  additionalProperties: false,
});

const TestIdParams = Type.Object({ testId: Type.String({ format: "uuid" }) });
const QuestionParams = Type.Object({
  testId: Type.String({ format: "uuid" }),
  questionId: Type.String({ format: "uuid" }),
});

type OptionInputT = { text: string; imageUrl?: string; correct: boolean };

/**
 * Turns authoring input (options flagged correct) into stored form: options get
 * server-assigned ids, and the correct ids are derived. Validates the choice
 * rules that the JSON schema can't express cross-field.
 */
function buildOptions(
  input: OptionInputT[],
  type: "mcq_single" | "mcq_multiple",
): { options: McqOption[]; correctOptionIds: string[] } {
  const options: McqOption[] = input.map((o) => ({
    id: randomUUID(),
    text: o.text,
    ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
  }));
  const correctOptionIds = options
    .filter((_, i) => input[i].correct)
    .map((o) => o.id);

  if (correctOptionIds.length === 0) {
    throw AppError.badRequest("Mark at least one correct option");
  }
  if (type === "mcq_single" && correctOptionIds.length !== 1) {
    throw AppError.badRequest(
      "A single-correct question must have exactly one correct option",
    );
  }
  return { options, correctOptionIds };
}

function serializeQuestion(row: QuestionRow) {
  const correct = new Set(row.correctOptionIds);
  return {
    id: row.id,
    testId: row.testId,
    type: row.type,
    prompt: row.prompt,
    imageUrl: row.imageUrl,
    points: row.points,
    negativeMarking: row.negativeMarking,
    gradingMode: row.gradingMode,
    position: row.position,
    options: row.options.map((o) => ({
      id: o.id,
      text: o.text,
      imageUrl: o.imageUrl ?? null,
      correct: correct.has(o.id),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * MCQ authoring, nested under a test and owner-scoped. Mutations respect the
 * test immutability guard (a published test with attempts in progress cannot
 * gain or lose questions). Candidate rendering/answer capture is the attempt
 * flow (PRO-7/PRO-8); auto-grading lives in lib/grading.ts.
 */
@Controller("v1/tests/:testId/questions")
export class QuestionsController {
  @Post()
  @RequireWrite()
  @HttpCode(201)
  async create(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() rawBody: unknown,
  ) {
    const { testId } = validate(TestIdParams, params);
    const body = validate(CreateQuestionBody, rawBody);
    const test = await findOrgTest(testId, auth.orgId);
    await assertTestMutable(test);

    const { options, correctOptionIds } = buildOptions(body.options, body.type);
    const gradingMode =
      body.type === "mcq_single"
        ? "all_or_nothing"
        : (body.gradingMode ?? "all_or_nothing");

    const position =
      body.position ??
      (await db
        .select({ total: count() })
        .from(questions)
        .where(eq(questions.testId, test.id))
        .then(([r]) => r.total));

    const [row] = await db
      .insert(questions)
      .values({
        testId: test.id,
        type: body.type,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        options,
        correctOptionIds,
        gradingMode,
        points: body.points,
        negativeMarking: body.negativeMarking,
        position,
      })
      .returning();
    return serializeQuestion(row);
  }

  @Get()
  async list(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { testId } = validate(TestIdParams, params);
    const test = await findOrgTest(testId, auth.orgId);
    const rows = await db
      .select()
      .from(questions)
      .where(eq(questions.testId, test.id))
      .orderBy(asc(questions.position), asc(questions.createdAt));
    return rows.map(serializeQuestion);
  }

  @Get(":questionId")
  async get(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const p = validate(QuestionParams, params);
    await findOrgTest(p.testId, auth.orgId);
    return serializeQuestion(await findQuestion(p));
  }

  @Patch(":questionId")
  @RequireWrite()
  async update(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() rawBody: unknown,
  ) {
    const p = validate(QuestionParams, params);
    const body = validate(UpdateQuestionBody, rawBody);
    const test = await findOrgTest(p.testId, auth.orgId);
    await assertTestMutable(test);
    const existing = await findQuestion(p);

    const type = body.type ?? existing.type;
    // Rebuild options/correct ids if either options or type changed.
    let optionFields: Partial<QuestionRow> = {};
    if (body.options) {
      optionFields = buildOptions(body.options, type);
    } else if (body.type && body.type !== existing.type) {
      // Type changed without new options — re-validate the existing set.
      if (type === "mcq_single" && existing.correctOptionIds.length !== 1) {
        throw AppError.badRequest(
          "A single-correct question must have exactly one correct option",
        );
      }
    }
    const gradingMode =
      type === "mcq_single"
        ? "all_or_nothing"
        : (body.gradingMode ?? existing.gradingMode);

    const [row] = await db
      .update(questions)
      .set({
        ...(body.type !== undefined && { type: body.type }),
        ...(body.prompt !== undefined && { prompt: body.prompt }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
        ...(body.points !== undefined && { points: body.points }),
        ...(body.negativeMarking !== undefined && {
          negativeMarking: body.negativeMarking,
        }),
        ...(body.position !== undefined && { position: body.position }),
        gradingMode,
        ...optionFields,
      })
      .where(eq(questions.id, existing.id))
      .returning();
    return serializeQuestion(row);
  }

  @Delete(":questionId")
  @RequireWrite()
  @HttpCode(204)
  async remove(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ): Promise<void> {
    const p = validate(QuestionParams, params);
    const test = await findOrgTest(p.testId, auth.orgId);
    await assertTestMutable(test);
    const existing = await findQuestion(p);
    await db.delete(questions).where(eq(questions.id, existing.id));
  }
}

/** Loads a question that belongs to the given test, or throws 404. */
async function findQuestion(params: {
  testId: string;
  questionId: string;
}): Promise<QuestionRow> {
  const [row] = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.id, params.questionId),
        eq(questions.testId, params.testId),
      ),
    )
    .limit(1);
  if (!row) {
    throw AppError.notFound("Question not found");
  }
  return row;
}
