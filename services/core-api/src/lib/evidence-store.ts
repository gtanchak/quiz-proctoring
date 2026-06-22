import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

/**
 * Object storage for proctoring evidence (PRO-27). Evidence is private: the
 * bytes never stream through the API and are only ever reached through signed,
 * time-limited URLs (CLAUDE.md §5). The candidate uploads a snapshot straight to
 * S3 with a presigned PUT; an admin retrieves it with a presigned GET.
 *
 * The interface is injectable (see {@link setEvidenceStore}) so tests run with a
 * fake — no AWS — exactly as the violation log client and email sender do.
 */

/** A presigned upload target plus the headers the client must echo on the PUT. */
export interface PresignedUpload {
  url: string;
  /** Headers the signature covers — the client MUST send these unchanged. */
  headers: Record<string, string>;
}

export interface EvidenceStore {
  /**
   * Deterministic object key for a snapshot's bytes, so a retried grant for the
   * same snapshot resolves to the same object rather than orphaning bytes.
   */
  keyFor(attemptId: string, snapshotId: string): string;
  /** A presigned PUT URL to upload one object's bytes directly to storage. */
  presignUpload(key: string, contentType: string): Promise<PresignedUpload>;
  /** A presigned GET URL to retrieve one object's bytes. */
  presignDownload(key: string): Promise<string>;
  /** Permanently delete objects by key. Idempotent (missing keys are ignored). */
  deleteObjects(keys: string[]): Promise<void>;
}

/** S3-backed store. Credentials come from the default AWS chain (the task role). */
export class S3EvidenceStore implements EvidenceStore {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: config.AWS_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  }

  keyFor(attemptId: string, snapshotId: string): string {
    return `evidence/${attemptId}/snapshots/${snapshotId}`;
  }

  async presignUpload(
    key: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: config.EVIDENCE_UPLOAD_URL_TTL },
    );
    // ContentType is a signed header for a PutObject, so the client must send it.
    return { url, headers: { "Content-Type": contentType } };
  }

  async presignDownload(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: config.EVIDENCE_GET_URL_TTL },
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    // DeleteObjects handles up to 1000 keys per call; chunk to stay within that.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }
}

/**
 * Process-wide override (defaults to the S3 store built from config). Tests
 * install a fake via {@link setEvidenceStore}; production leaves it null and
 * uses S3. Mirrors `setViolationsClient` / the email sender.
 */
let overrideStore: EvidenceStore | null = null;

export function setEvidenceStore(store: EvidenceStore | null): void {
  overrideStore = store;
}

export function getEvidenceStore(): EvidenceStore {
  if (overrideStore) {
    return overrideStore;
  }
  if (!config.EVIDENCE_BUCKET) {
    throw new Error(
      "EVIDENCE_BUCKET is not configured — cannot store or retrieve evidence",
    );
  }
  return new S3EvidenceStore(config.EVIDENCE_BUCKET);
}
