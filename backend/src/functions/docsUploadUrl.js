const { app } = require("@azure/functions");
const { v4: uuidv4 } = require("uuid");
const { requireAuth } = require("../lib/auth");
const { json, error } = require("../lib/responses");
const { config } = require("../lib/config");
const { sanitizeFileName } = require("../lib/utils");
const { buildBlobSasUrl } = require("../lib/storage");
const { upsertDocument, isoNow } = require("../lib/tables");

app.http("docs-upload-url", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "docs/upload-url",
  handler: async (request) => {
    let identity;
    try {
      identity = requireAuth(request);
    } catch (authError) {
      return authError;
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return error(400, "invalid_json", "Body must be valid JSON");
    }

    const fileName = sanitizeFileName(payload?.fileName || "source.pdf");
    const contentType = String(payload?.contentType || "application/pdf").toLowerCase();

    if (contentType !== "application/pdf") {
      return error(400, "validation_error", "Only application/pdf is supported");
    }

    const docId = uuidv4();
    const blobName = `${identity.email}/${docId}/${fileName}`;
    const uploadSas = buildBlobSasUrl(config.sourceContainer, blobName, "cw", 15);
    const readSas = buildBlobSasUrl(config.sourceContainer, blobName, "r", 120);
    const now = isoNow();

    await upsertDocument({
      docId,
      ownerEmail: identity.email,
      title: fileName,
      blobPath: `${config.sourceContainer}/${blobName}`,
      sourceBlobName: blobName,
      contentType,
      annotationJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    return json(200, {
      docId,
      sasUrl: uploadSas.url,
      blobPath: `${config.sourceContainer}/${blobName}`,
      readUrl: readSas.url,
      expiresAt: uploadSas.expiresOn,
      maxUploadBytes: config.maxUploadBytes
    });
  }
});