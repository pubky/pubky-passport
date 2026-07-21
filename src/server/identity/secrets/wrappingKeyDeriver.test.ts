import { describe, expect, it } from "vitest";

import { ServerWrappingKeyDeriver, createServerWrappingKeyDeriver } from "./wrappingKeyDeriver";

const serverSecret = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
const otherServerSecret = Buffer.from("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f", "hex");

describe("ServerWrappingKeyDeriver", () => {
  it("derives stable base64url wrapping material for the same issuer and subject", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    const first = await deriver.deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    });
    const second = await deriver.deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    });

    expect(first).toEqual(second);
    expect(first.wrappingKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(first.wrappingKey, "base64url")).toHaveLength(32);
  });

  it("uses deterministic HKDF fixtures", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    await expect(
      deriver.deriveWrappingKey({
        provider: "google",
        issuer: "https://accounts.google.com",
        subject: "google-subject",
      }),
    ).resolves.toEqual({ wrappingKey: "0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE" });
  });

  it("preserves the frozen Google HKDF info prefix for existing custody", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    await expect(
      deriver.deriveWrappingKey({
        provider: "google",
        issuer: "https://accounts.google.com",
        subject: "test-subject",
      }),
    ).resolves.toEqual({ wrappingKey: "VzVs2hX0bykhMyq1CvPwjMgpFFHaUYwQGu4usnPCoNc" });
  });

  it("derives different material for different subjects", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    const first = await deriver.deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    });
    const second = await deriver.deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "other-google-subject",
    });

    expect(first.wrappingKey).not.toBe(second.wrappingKey);
  });

  it("rejects noncanonical Google issuers", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    await expect(
      deriver.deriveWrappingKey({
        provider: "google",
        issuer: "accounts.google.com",
        subject: "google-subject",
      }),
    ).rejects.toThrow("Invalid wrapping key identity.");
  });

  it("derives different material for different server secrets", async () => {
    const first = await new ServerWrappingKeyDeriver({ serverSecret }).deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    });
    const second = await new ServerWrappingKeyDeriver({ serverSecret: otherServerSecret }).deriveWrappingKey({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "google-subject",
    });

    expect(first.wrappingKey).not.toBe(second.wrappingKey);
  });

  it("creates a deriver from PASSPORT_SERVER_SECRET_BASE64-compatible config", async () => {
    const deriver = createServerWrappingKeyDeriver({ serverSecretBase64: serverSecret.toString("base64") });

    await expect(
      deriver.deriveWrappingKey({
        provider: "google",
        issuer: "https://accounts.google.com",
        subject: "google-subject",
      }),
    ).resolves.toEqual({ wrappingKey: "0Rvmd96LjmVRcQ7WjvQBSUKwlI1YHO_4xmqDELjAGOE" });
  });

  it("rejects invalid server secret configuration safely", () => {
    expect(() => createServerWrappingKeyDeriver({ serverSecretBase64: "not-base64!" })).toThrow(
      "Invalid wrapping key configuration.",
    );
    expect(() => createServerWrappingKeyDeriver({ serverSecretBase64: Buffer.alloc(31).toString("base64") })).toThrow(
      "Invalid wrapping key configuration.",
    );
  });

  it("rejects empty issuer or subject safely", async () => {
    const deriver = new ServerWrappingKeyDeriver({ serverSecret });

    await expect(
      deriver.deriveWrappingKey({ provider: "google", issuer: "", subject: "google-subject" }),
    ).rejects.toThrow("Invalid wrapping key identity.");
    await expect(
      deriver.deriveWrappingKey({ provider: "google", issuer: "https://accounts.google.com", subject: "" }),
    ).rejects.toThrow("Invalid wrapping key identity.");
  });
});
