import { Type, type Static } from "@sinclair/typebox";

/**
 * Authentication & accounts contract (PRO-39).
 *
 * The cross-boundary shapes for the admin accounts system: roles, the
 * sanitised entity DTOs returned to clients, and the request/response bodies
 * for the auth endpoints. Defined once here so core-api, both web apps, and any
 * future service share one definition (CLAUDE.md §4).
 *
 * What is deliberately NOT here: password hashes, raw/hashed tokens, and any
 * other server-only secret. Those live in core-api and never cross a boundary.
 *
 * Composition note: DTOs are embedded into request/response schemas by value
 * (no `$id`/`$ref`). This keeps `Static<>` inference exact and avoids Ajv
 * "duplicate schema id" errors when several Fastify routes each compile a
 * schema that embeds the same DTO.
 */

/**
 * Account roles, most-privileged first:
 * - `owner`  — created the account; can manage members, roles, and the org.
 * - `admin`  — full read/write on tests, attempts, and reports.
 * - `viewer` — read-only (a reviewer who inspects results but cannot edit).
 */
export const ROLES = ["owner", "admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const RoleSchema = Type.Union(ROLES.map((r) => Type.Literal(r)), {
  description: "Account role (see ROLES)",
});

/** Roles that may mutate tests/questions/invites/attempts. `viewer` may not. */
export const WRITE_ROLES = ["owner", "admin"] as const;

/** What kind of credential authenticated a request. */
export const ACTOR_TYPES = ["user", "apiKey"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

const ActorTypeSchema = Type.Union(ACTOR_TYPES.map((a) => Type.Literal(a)));

/**
 * Password policy, shared so signup, reset, and change-password validate
 * identically on client and server. A generous minimum length favours
 * passphrases over composition rules.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

const PasswordSchema = Type.String({
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
  description: `Password (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} chars)`,
});

const EmailSchema = Type.String({ format: "email", maxLength: 320 });

// --- Entity DTOs (response shapes; no secrets) ------------------------------

export const OrganizationDtoSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type OrganizationDto = Static<typeof OrganizationDtoSchema>;

export const UserDtoSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    orgId: Type.String({ format: "uuid" }),
    email: Type.String({ format: "email" }),
    name: Type.String(),
    role: RoleSchema,
    /** null until the user verifies their email. */
    emailVerifiedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type UserDto = Static<typeof UserDtoSchema>;

/** Session metadata for listing/auditing — never includes the token itself. */
export const SessionDtoSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    createdAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" }),
    lastUsedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SessionDto = Static<typeof SessionDtoSchema>;

// --- Request / response bodies ----------------------------------------------

export const SignupRequestSchema = Type.Object(
  {
    orgName: Type.String({ minLength: 1, maxLength: 200 }),
    email: EmailSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    password: PasswordSchema,
  },
  { additionalProperties: false },
);
export type SignupRequest = Static<typeof SignupRequestSchema>;

/** Signup does not return a session — the user must verify their email first. */
export const SignupResponseSchema = Type.Object(
  {
    user: UserDtoSchema,
    org: OrganizationDtoSchema,
  },
  { additionalProperties: false },
);
export type SignupResponse = Static<typeof SignupResponseSchema>;

export const VerifyEmailRequestSchema = Type.Object(
  { token: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type VerifyEmailRequest = Static<typeof VerifyEmailRequestSchema>;

export const LoginRequestSchema = Type.Object(
  {
    email: EmailSchema,
    // Login accepts any non-empty password; the policy is enforced at the point
    // a password is *set*, not when an existing one is presented.
    password: Type.String({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH }),
  },
  { additionalProperties: false },
);
export type LoginRequest = Static<typeof LoginRequestSchema>;

export const LoginResponseSchema = Type.Object(
  {
    user: UserDtoSchema,
    /** Opaque session token. Send as `Authorization: Bearer <token>`. */
    sessionToken: Type.String(),
    expiresAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type LoginResponse = Static<typeof LoginResponseSchema>;

export const RequestPasswordResetRequestSchema = Type.Object(
  { email: EmailSchema },
  { additionalProperties: false },
);
export type RequestPasswordResetRequest = Static<
  typeof RequestPasswordResetRequestSchema
>;

/** Re-issue an email-verification link for an unverified account (PRO-55). */
export const RequestEmailVerificationRequestSchema = Type.Object(
  { email: EmailSchema },
  { additionalProperties: false },
);
export type RequestEmailVerificationRequest = Static<
  typeof RequestEmailVerificationRequestSchema
>;

export const ResetPasswordRequestSchema = Type.Object(
  { token: Type.String({ minLength: 1 }), password: PasswordSchema },
  { additionalProperties: false },
);
export type ResetPasswordRequest = Static<typeof ResetPasswordRequestSchema>;

export const ChangePasswordRequestSchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH }),
    newPassword: PasswordSchema,
  },
  { additionalProperties: false },
);
export type ChangePasswordRequest = Static<typeof ChangePasswordRequestSchema>;

export const UpdateProfileRequestSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
export type UpdateProfileRequest = Static<typeof UpdateProfileRequestSchema>;

// --- Org member management (owner-only) -------------------------------------

/** Assignable roles for members — `owner` is established at signup, not granted. */
const AssignableRoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("viewer"),
]);

/**
 * Invite a teammate into the org. No password here — the invited member sets
 * their own password via an emailed link (the user creates their own
 * credentials; the owner only grants the seat and role).
 */
export const CreateMemberRequestSchema = Type.Object(
  {
    email: EmailSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    role: AssignableRoleSchema,
  },
  { additionalProperties: false },
);
export type CreateMemberRequest = Static<typeof CreateMemberRequestSchema>;

export const ChangeRoleRequestSchema = Type.Object(
  { role: AssignableRoleSchema },
  { additionalProperties: false },
);
export type ChangeRoleRequest = Static<typeof ChangeRoleRequestSchema>;

// --- Identity ("who am I") --------------------------------------------------

/**
 * The authenticated identity, discriminated by `actorType`. A user session
 * carries the full `UserDto`; a machine API key carries its id and name.
 */
export const MeResponseSchema = Type.Object(
  {
    actorType: ActorTypeSchema,
    orgId: Type.String({ format: "uuid" }),
    user: Type.Optional(UserDtoSchema),
    apiKey: Type.Optional(
      Type.Object({
        id: Type.String({ format: "uuid" }),
        name: Type.String(),
      }),
    ),
  },
  { additionalProperties: false },
);
export type MeResponse = Static<typeof MeResponseSchema>;
