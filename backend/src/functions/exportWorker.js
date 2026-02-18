const { app } = require("@azure/functions");
const { config } = require("../lib/config");
const { decodeQueueMessage } = require("../lib/utils");
const { getDocument, updateJob, isoNow } = require("../lib/tables");
const { downloadToBuffer, uploadBuffer, buildBlobSasUrl } = require("../lib/storage");

app.storageQueue("export-worker", {
  queueName: config.exportQueue,
  connection: "STORAGE_CONNECTION_STRING",
  handler: async (message, context) => {
    const task = decodeQueueMessage(message);
    const jobId = String(task.jobId || "");
    const docId = String(task.docId || "");

    if (!jobId || !docId) {
      context.error("Invalid export message payload");
      return;
    }

    try {
      await updateJob(jobId, {
        status: "running",
        updatedAt: isoNow(),
        attempt: Number(task.attempt || 0)
      });

      const doc = await getDocument(docId);
      if (!doc || !doc.sourceBlobName) {
        throw new Error("Document metadata missing source blob reference");
      }

      const sourceBuffer = await downloadToBuffer(config.sourceContainer, doc.sourceBlobName);
      const exportBlobName = `${task.ownerEmail}/${docId}/${jobId}.pdf`;
      await uploadBuffer(config.exportContainer, exportBlobName, sourceBuffer, "application/pdf");

      const readSas = buildBlobSasUrl(config.exportContainer, exportBlobName, "r", 60 * 24);
      await updateJob(jobId, {
        status: "completed",
        updatedAt: isoNow(),
        resultUri: readSas.url,
        error: null
      });
    } catch (err) {
      context.error(`Export worker failed for job ${jobId}: ${err.message}`);
      await updateJob(jobId, {
        status: "failed",
        updatedAt: isoNow(),
        error: err.message
      });
      throw err;
    }
  }
});