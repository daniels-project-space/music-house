import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServiceSecrets } from "./vault";

const BUCKET = process.env.R2_BUCKET ?? "music-house";

let clientPromise: Promise<S3Client> | null = null;

async function client(): Promise<S3Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const env = await getServiceSecrets("cloudflare");
      const accountId = env.R2_ACCOUNT_ID;
      const accessKeyId = env.R2_ACCESS_KEY_ID;
      const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
      const endpoint = env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
      return new S3Client({
        region: "auto",
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
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

export async function head(key: string) {
  const c = await client();
  try {
    const r = await c.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType, etag: r.ETag };
  } catch {
    return null;
  }
}

export async function remove(key: string) {
  const c = await client();
  await c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function list(prefix?: string, max = 1000): Promise<string[]> {
  const c = await client();
  const r = await c.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: max }));
  return (r.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

export async function presignDownload(key: string, expiresIn = 3600): Promise<string> {
  const c = await client();
  return getSignedUrl(c, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export async function presignUpload(key: string, expiresIn = 3600, contentType?: string): Promise<string> {
  const c = await client();
  return getSignedUrl(c, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn });
}
