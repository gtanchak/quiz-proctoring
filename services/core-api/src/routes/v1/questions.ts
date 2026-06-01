import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  type McqOption,
  questions,
  type QuestionRow,
} from "../../db/schema/tests.js";
import { requireWrite } from "../../lib/authz.js";
import { AppError } from "../../lib/errors.js";
import { assertTestMutable, findOrgTest } from "../../lib/test-access.js";

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

const QuestionEntity = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    testId: Type.String({ format: "uuid" }),
    type: QuestionType,
    prompt: Type.String(),
    imageUrl: Type.Union([Type.String(), Type.Null()]),
    points: Type.Integer(),
    negativeMarking: Type.Boolean(),
    gradingMode: GradingMode,
    position: Type.Integer(),
    options: Type.Array(
      Type.Object({
        id: Type.String(),
        text: Type.String(),
        imageUrl: Type.Union([Type.String(), Type.Null()]),
        correct: Type.Boolean(),
      }),
    ),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "Question" },
);

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
export const questionsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/tests/:testId/questions",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["questions"],
        summary: "Add an MCQ question to a test",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        body: CreateQuestionBody,
        response: {
          201: QuestionEntity,
          400: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findOrgTest(request.params.testId, request.auth!.orgId);
      await assertTestMutable(test);

      const body = request.body;
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
      reply.status(201);
      return serializeQuestion(row);
    },
  );

  app.get(
    "/tests/:testId/questions",
    {
      schema: {
        tags: ["questions"],
        summary: "List a test's questions",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        response: {
          200: Type.Array(QuestionEntity),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const test = await findOrgTest(request.params.testId, request.auth!.orgId);
      const rows = await db
        .select()
        .from(questions)
        .where(eq(questions.testId, test.id))
        .orderBy(asc(questions.position), asc(questions.createdAt));
      return rows.map(serializeQuestion);
    },
  );

  app.get(
    "/tests/:testId/questions/:questionId",
    {
      schema: {
        tags: ["questions"],
        summary: "Get a question",
        security: [{ bearerAuth: [] }],
        params: QuestionParams,
        response: { 200: QuestionEntity, 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      await findOrgTest(request.params.testId, request.auth!.orgId);
      return serializeQuestion(await findQuestion(request.params));
    },
  );

  app.patch(
    "/tests/:testId/questions/:questionId",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["questions"],
        summary: "Update a question",
        security: [{ bearerAuth: [] }],
        params: QuestionParams,
        body: UpdateQuestionBody,
        response: {
          200: QuestionEntity,
          400: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const test = await findOrgTest(
        request.params.testId,
        request.auth!.orgId,
      );
      await assertTestMutable(test);
      const existing = await findQuestion(request.params);

      const body = request.body;
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
    },
  );

  app.delete(
    "/tests/:testId/questions/:questionId",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["questions"],
        summary: "Delete a question",
        security: [{ bearerAuth: [] }],
        params: QuestionParams,
        response: {
          204: Type.Null(),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findOrgTest(
        request.params.testId,
        request.auth!.orgId,
      );
      await assertTestMutable(test);
      const existing = await findQuestion(request.params);
      await db.delete(questions).where(eq(questions.id, existing.id));
      reply.status(204);
      return null;
    },
  );
};

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
