const { app } = require("@azure/functions");
const { requireAuth } = require("../lib/auth");
const { json, error } = require("../lib/responses");
const { getJob } = require("../lib/tables");

app.http("jobs-get", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "jobs/{jobId}",
  handler: async (request) => {
    let identity;
    try {
      identity = requireAuth(request);
    } catch (authError) {
      return authError;
    }

    const jobId = request.params.jobId;
    const job = await getJob(jobId);
    if (!job) {
      return error(404, "not_found", "Job not found");
    }

    if (String(job.ownerEmail || "").toLowerCase() !== identity.email) {
      return error(403, "forbidden", "You do not own this job");
    }

    return json(200, {
      jobId,
      status: String(job.status || "unknown"),
      type: String(job.type || ""),
      resultUri: job.resultUri || null,
      error: job.error || null,
      updatedAt: job.updatedAt || null
    });
  }
});