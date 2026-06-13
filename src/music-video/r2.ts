/**
 * Trigger-safe R2 (S3) client for the standalone Music Video pipeline.
 * Mirrors src/lib/storage.ts but without `import "server-only"` so it can run
 * inside Trigger.dev tasks and CLI scripts. Same bucket, same credentials.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServiceSecrets } from "./vault";

const BUCKET = process.env.R2_BUCKET ?? "music-house";

let clientPromise: Promise<S3Client> | null = null;

async function client(): Promise<S3Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const env = await getServiceSecrets("cloudflare");
      const accountId = env.R2_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID;
      const accessKeyId = env.R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID!;
      const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY!;
      const endpoint =
        env.R2_ENDPOINT || process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
      return new S3Client({
        region: "auto",
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    })();
  }
  return clientPromise;
}

export async function put(key: string, body: Buffer | Uint8Array | string, contentType?: string) {
  const c = await client();
  await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getBuffer(key: string): Promise<Buffer> {
  const c = await client();
  const r = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function exists(key: string): Promise<boolean> {
  const c = await client();
  try {
    await c.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Download an R2 object to a local file path. */
export async function downloadToFile(key: string, destPath: string): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const buf = await getBuffer(key);
  await writeFile(destPath, buf);
  return destPath;
}

export async function presignDownload(key: string, expiresIn = 86400): Promise<string> {
  const c = await client();
  return getSignedUrl(c, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}
