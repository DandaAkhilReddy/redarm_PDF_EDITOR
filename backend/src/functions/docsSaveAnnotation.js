const { app } = require("@azure/functions");
const { requireAuth } = require("../lib/auth");
const { json, error } = require("../lib/responses");
const { getDocument, upsertDocument, isoNow } = require("../lib/tables");

function validateAnnotationPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "payload must be an object";
  }

  if (!Array.isArray(payload.operations)) {
    return "operations must be an array";
  }

  if (payload.operations.length > 1000) {
    return "too many operations";
  }

  return "";
}

app.http("docs-save-annotation", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "docs/{docId}/save-annotation",
  handler: async (request) => {
    let identity;
    try {
      identity = requireAuth(request);
    } catch (authError) {
      return authError;
    }

    const docId = request.params.docId;
    if (!docId) {
      return error(400, "validation_error", "docId is required");
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return error(400, "invalid_json", "Body must be valid JSON");
    }

    const validationError = validateAnnotationPayload(payload);
    if (validationError) {
      return error(400, "validation_error", validationError);
    }

    const document = await getDocument(docId);
    if (!document) {
      return error(404, "not_found", "Document not found");
    }

    if (String(document.ownerEmail || "").toLowerCase() !== identity.email) {
      return error(403, "forbidden", "You do not own this document");
    }

    const nextVersion = Number(document.version || 1) + 1;
    await upsertDocument({
      docId,
      annotationJson: JSON.stringify(payload),
      version: nextVersion,
      updatedAt: isoNow()
    });

    return json(200, {
      ok: true,
      versionId: `v${nextVersion}`
    });
  }
});