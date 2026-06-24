import { Type, type Static, type TSchema } from "@sinclair/typebox";

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
 * Account roles, most-privileged first (PRO-57 multi-tenant taxonomy):
 * - `platform_admin` — cross-tenant super-admin (provisions tenants). Not scoped
 *   to a single tenant's data.
 * - `tenant_admin`   — created/owns the tenant; manages members, roles, settings.
 * - `recruiter`      — full read/write on tests, attempts, and reports.
 * - `reviewer`       — read-only (inspects results but cannot edit).
 * - `candidate`      — the assessment taker (reserved; candidates authenticate by
 *   per-attempt session token today, not a user account).
 */
export const ROLES = [
  "platform_admin",
  "tenant_admin",
  "recruiter",
  "reviewer",
  "candidate",
] as const;
export type Role = (typeof ROLES)[number];

export const RoleSchema = Type.Union(ROLES.map((r) => Type.Literal(r)), {
  description: "Account role (see ROLES)",
});

/** Roles that may mutate tests/questions/invites/attempts. `reviewer` may not. */
export const WRITE_ROLES = ["tenant_admin", "recruiter"] as const;

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

/** Assignable roles for members — `tenant_admin` is established at signup, not granted. */
const AssignableRoleSchema = Type.Union([
  Type.Literal("recruiter"),
  Type.Literal("reviewer"),
]);

/**
 * Invite a teammate into the tenant. No password here — the invited member sets
 * their own password via an emailed link (the user creates their own
 * credentials; the tenant admin only grants the seat and role).
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

// --- Platform tenant provisioning (platform_admin only, PRO-57) -------------

/**
 * Provision a new tenant. The platform admin names the tenant and nominates its
 * first `tenant_admin`; that admin sets their own password via an emailed link
 * (we never provision credentials on their behalf — same flow as member invite).
 */
export const ProvisionTenantRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    adminEmail: EmailSchema,
    adminName: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type ProvisionTenantRequest = Static<typeof ProvisionTenantRequestSchema>;

/** Result of provisioning: the new tenant and its first (invited) admin. */
export const ProvisionTenantResponseSchema = Type.Object(
  {
    tenant: OrganizationDtoSchema,
    admin: UserDtoSchema,
  },
  { additionalProperties: false },
);
export type ProvisionTenantResponse = Static<
  typeof ProvisionTenantResponseSchema
>;

/** A tenant as listed by a platform admin, with its member count. */
export const TenantSummaryDtoSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    memberCount: Type.Integer(),
  },
  { additionalProperties: false },
);
export type TenantSummaryDto = Static<typeof TenantSummaryDtoSchema>;

// --- Per-tenant branding (PRO-57, FR-39) ------------------------------------

const NullableString = <T extends TSchema>(schema: T) =>
  Type.Union([schema, Type.Null()]);

/** A logo URL (https), a hex colour, and a DNS-label subdomain. */
const LogoUrlSchema = Type.String({ maxLength: 2000 });
const ColorSchema = Type.String({
  pattern: "^#[0-9a-fA-F]{6}$",
  description: "Hex colour, e.g. #1a2b3c",
});
const SubdomainSchema = Type.String({
  pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
  minLength: 1,
  maxLength: 63,
  description: "Lowercase DNS label (a–z, 0–9, hyphen)",
});

/** A tenant's current branding (nulls mean "use platform defaults"). */
export const TenantBrandingSchema = Type.Object(
  {
    logoUrl: NullableString(LogoUrlSchema),
    primaryColor: NullableString(ColorSchema),
    subdomain: NullableString(SubdomainSchema),
  },
  { additionalProperties: false },
);
export type TenantBranding = Static<typeof TenantBrandingSchema>;

/**
 * Update tenant branding (tenant_admin). Every field is optional; an explicit
 * `null` clears it back to the platform default.
 */
export const UpdateTenantBrandingRequestSchema = Type.Object(
  {
    logoUrl: Type.Optional(NullableString(LogoUrlSchema)),
    primaryColor: Type.Optional(NullableString(ColorSchema)),
    subdomain: Type.Optional(NullableString(SubdomainSchema)),
  },
  { additionalProperties: false },
);
export type UpdateTenantBrandingRequest = Static<
  typeof UpdateTenantBrandingRequestSchema
>;

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
