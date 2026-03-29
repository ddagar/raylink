import forge from "node-forge";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CertificateInfo {
  cert: string; // PEM
  key: string; // PEM
  fingerprint: string; // SHA-256 hex
}

const CERT_VALIDITY_YEARS = 10;

function getDataDir(): string {
  return join(process.env.HOME || "~", ".raycast-android");
}

export function getCertPath(): string {
  return join(getDataDir(), "cert.pem");
}

export function getKeyPath(): string {
  return join(getDataDir(), "key.pem");
}

export function getDeviceId(): string {
  // Derive a stable device ID from the certificate fingerprint
  // Falls back to hostname if cert doesn't exist yet
  return `mac-${process.env.USER || "unknown"}-${process.pid}`;
}

export function computeFingerprint(certPem: string): string {
  const hash = createHash("sha256");
  hash.update(certPem);
  return hash.digest("hex");
}

export function computeVerificationCode(certA: string, certB: string): string {
  const hash = createHash("sha256");
  // Sort to ensure both sides compute the same code regardless of order
  const sorted = [certA, certB].sort();
  hash.update(sorted[0]);
  hash.update(sorted[1]);
  const hex = hash.digest("hex");
  // Take first 6 digits
  const num = parseInt(hex.substring(0, 8), 16) % 1000000;
  return num.toString().padStart(6, "0");
}

export async function generateCertificate(): Promise<CertificateInfo> {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + CERT_VALIDITY_YEARS
  );

  const hostname = (await import("node:os")).hostname();
  const attrs = [
    { name: "commonName", value: `RayLink-${hostname}` },
    { name: "organizationName", value: "RayLink" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true,
    },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const fingerprint = computeFingerprint(certPem);

  return { cert: certPem, key: keyPem, fingerprint };
}

export async function loadOrCreateCertificate(): Promise<CertificateInfo> {
  const dataDir = getDataDir();
  const certPath = getCertPath();
  const keyPath = getKeyPath();

  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = await readFile(certPath, "utf-8");
    const key = await readFile(keyPath, "utf-8");
    const fingerprint = computeFingerprint(cert);
    return { cert, key, fingerprint };
  }

  // Generate new certificate
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  const certInfo = await generateCertificate();
  await writeFile(certPath, certInfo.cert, { mode: 0o600 });
  await writeFile(keyPath, certInfo.key, { mode: 0o600 });

  return certInfo;
}
