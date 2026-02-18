const { app } = require("@azure/functions");
const { v4: uuidv4 } = require("uuid");
const { requireAuth } = require("../lib/auth");
const { json, error } = require("../lib/responses");
const { createJob, getDocument, isoNow } = require("../lib/tables");
const { sendQueueMessage } = require("../lib/storage");
const { config } = require("../lib/config");

function isValidPagesInput(pages) {
  if (!pages) {
    return true;
  }
  return /^[0-9,-]+$/.test(String(pages));
}

app.http("docs-ocr-start", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "docs/{docId}/ocr",
  handler: async (request) => {
    let identity;
    try {
      identity = requireAuth(request);
    } catch (authError) {
      return authError;
    }

    const docId = request.params.docId;
    const doc = await getDocument(docId);
    if (!doc) {
      return error(404, "not_found", "Document not found");
    }
    if (String(doc.ownerEmail || "").toLowerCase() !== identity.email) {
      return error(403, "forbidden", "You do not own this document");
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    if (!isValidPagesInput(payload.pages)) {
      return error(400, "validation_error", "pages must contain only digits, commas, and dashes");
    }

    const jobId = uuidv4();
    const now = isoNow();
    await createJob({
      jobId,
      type: "ocr",
      status: "queued",
      docId,
      ownerEmail: identity.email,
      pages: String(payload.pages || ""),
      createdAt: now,
      updatedAt: now,
      attempt: 0
    });

    await sendQueueMessage(config.ocrQueue, {
      jobId,
      docId,
      ownerEmail: identity.email,
      pages: String(payload.pages || ""),
      createdAt: now
    });

    return json(202, {
      jobId
    });
  }
});