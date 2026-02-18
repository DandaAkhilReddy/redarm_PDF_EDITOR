const { app } = require("@azure/functions");
const { AzureKeyCredential } = require("@azure/core-auth");
const { DocumentAnalysisClient } = require("@azure/ai-form-recognizer");
const { config } = require("../lib/config");
const { decodeQueueMessage } = require("../lib/utils");
const { getDocument, updateJob, isoNow } = require("../lib/tables");
const { downloadToBuffer, uploadJson, buildBlobSasUrl } = require("../lib/storage");

function createDocIntelClient() {
  if (!config.docIntelEndpoint || !config.docIntelKey) {
    return null;
  }
  return new DocumentAnalysisClient(config.docIntelEndpoint, new AzureKeyCredential(config.docIntelKey));
}

app.storageQueue("ocr-worker", {
  queueName: config.ocrQueue,
  connection: "STORAGE_CONNECTION_STRING",
  handler: async (message, context) => {
    const task = decodeQueueMessage(message);
    const jobId = String(task.jobId || "");
    const docId = String(task.docId || "");

    if (!jobId || !docId) {
      context.error("Invalid OCR message payload");
      return;
    }

    const client = createDocIntelClient();
    if (!client) {
      await updateJob(jobId, {
        status: "failed",
        updatedAt: isoNow(),
        error: "Document Intelligence not configured"
      });
      return;
    }

    try {
      await updateJob(jobId, {
        status: "running",
        updatedAt: isoNow()
      });

      const doc = await getDocument(docId);
      if (!doc || !doc.sourceBlobName) {
        throw new Error("Document metadata missing source blob reference");
      }

      const buffer = await downloadToBuffer(config.sourceContainer, doc.sourceBlobName);
      const options = {};
      if (task.pages) {
        options.pages = String(task.pages);
      }

      const poller = await client.beginAnalyzeDocument(config.docIntelModelId, buffer, options);
      const result = await poller.pollUntilDone();

      const ocrBlobName = `${task.ownerEmail}/${docId}/${jobId}.json`;
      await uploadJson(config.ocrContainer, ocrBlobName, {
        docId,
        jobId,
        model: config.docIntelModelId,
        pages: task.pages || null,
        analyzedAt: isoNow(),
        result
      });

      const readSas = buildBlobSasUrl(config.ocrContainer, ocrBlobName, "r", 60 * 24);
      await updateJob(jobId, {
        status: "completed",
        updatedAt: isoNow(),
        resultUri: readSas.url,
        error: null
      });
    } catch (err) {
      context.error(`OCR worker failed for job ${jobId}: ${err.message}`);
      await updateJob(jobId, {
        status: "failed",
        updatedAt: isoNow(),
        error: err.message
      });
      throw err;
    }
  }
});